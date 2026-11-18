const { app, BrowserWindow, dialog, ipcMain, shell, session, safeStorage, Menu, screen } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { isTrustedKForgeOrigin, toSafeExternalHttpUrl } = require("./trustOrigin.cjs");
const { createGitHubConnect } = require("./githubConnect.cjs");
const { createBoundedLogWriter } = require("./logFile.cjs");
const { APP_USER_MODEL_ID, createApplicationMenuTemplate } = require("./appMenu.cjs");
const { createWindowStateStore, ensureVisibleBounds } = require("./windowState.cjs");

const PRODUCT_NAME = "KNOuX Forge";
const DESKTOP_CHANNELS = new Set(["kforge:runtime", "kforge:github-start", "kforge:github-status", "kforge:github-disconnect", "kforge:github-installations", "kforge:github-repositories"]);
const isDevelopment = !app.isPackaged;
// Production resources are intentionally kept inside app.asar so the bundled
// server can resolve its production Node dependencies without relying on a
// source checkout or globally installed packages.
const applicationRoot = path.resolve(__dirname, "..");
const localAppData = process.env.LOCALAPPDATA || app.getPath("appData");
const userDataRoot = path.join(localAppData, PRODUCT_NAME);
const workspaceRoot = path.join(userDataRoot, "workspace");
const logsRoot = path.join(userDataRoot, "logs");
const logFile = path.join(logsRoot, "desktop.log");
const logWriter = createBoundedLogWriter(logFile);
const windowStateStore = createWindowStateStore(path.join(userDataRoot, "window-state.json"));
const githubConnect = createGitHubConnect({
  safeStorage,
  userDataRoot,
  workspaceRoot,
  external: (url) => shell.openExternal(url),
});

let mainWindow = null;
let productionServer = null;
let productionServerModule = null;
let isQuitting = false;
let startupError = null;
let fatalHandled = false;
let rendererRecoveryAttempts = 0;
let rendererRecoveryDialogOpen = false;

function redact(value) {
  return String(value)
    .replace(/(api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

function writeLog(level, message) {
  const line = `${new Date().toISOString()} [${level}] ${redact(message)}\n`;
  try {
    logWriter.write(line);
  } catch {
    // Logging must never prevent the desktop product from opening.
  }
}

function describeFailure(value) {
  let text;
  if (value instanceof Error) text = value.stack || value.message;
  else if (typeof value === "string") text = value;
  else {
    try { text = JSON.stringify(value); } catch { text = String(value); }
  }
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

function handleFatalFailure(kind, failure) {
  if (fatalHandled) return;
  fatalHandled = true;
  writeLog("ERROR", `${kind}: ${describeFailure(failure)}`);
  try {
    dialog.showErrorBox(
      `${PRODUCT_NAME} encountered an unexpected error`,
      `KNOuX Forge must close. The failure was written to the desktop diagnostics log.\n\nDiagnostics: ${logFile}`,
    );
  } catch {
    // The error dialog is best-effort when the main process is already unstable.
  }
  const exitTimer = setTimeout(() => app.exit(1), 5_000);
  exitTimer.unref();
  void stopLocalRuntime()
    .catch((error) => writeLog("ERROR", `Fatal shutdown cleanup failed: ${describeFailure(error)}`))
    .finally(() => {
      clearTimeout(exitTimer);
      app.exit(1);
    });
}

process.on("uncaughtException", (error) => handleFatalFailure("Uncaught exception", error));
process.on("unhandledRejection", (reason) => writeLog("ERROR", `Unhandled rejection: ${describeFailure(reason)}`));

async function openDiagnosticsFolder() {
  try {
    const failure = await shell.openPath(logsRoot);
    if (failure) writeLog("WARN", `Diagnostics folder could not be opened: ${failure}`);
  } catch (error) {
    writeLog("WARN", `Diagnostics folder could not be opened: ${describeFailure(error)}`);
  }
}

async function showAbout() {
  const metadata = desktopMetadata();
  const options = {
    type: "info",
    title: `About ${PRODUCT_NAME}`,
    message: `${PRODUCT_NAME} ${metadata.version}`,
    detail: [
      `Electron ${process.versions.electron}`,
      `Chromium ${process.versions.chrome}`,
      `Node.js ${process.versions.node}`,
      `${metadata.packaged ? "Packaged" : "Development"} runtime on ${metadata.platform} ${metadata.architecture}`,
      "",
      "Installer signing is verified per artifact; this running process does not self-verify its signature.",
      `Diagnostics: ${logFile}`,
    ].join("\n"),
    buttons: ["Open Diagnostics Folder", "Close"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const result = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
  if (result.response === 0) await openDiagnosticsFolder();
}

async function handleRendererGone(details) {
  if (isQuitting || fatalHandled || !details || details.reason === "clean-exit") return;
  writeLog("ERROR", `Renderer process gone: ${details.reason || "unknown"} (exitCode=${details.exitCode ?? "unknown"})`);
  if (rendererRecoveryDialogOpen) return;
  rendererRecoveryDialogOpen = true;
  try {
    const window = mainWindow;
    if (!window || window.isDestroyed()) {
      await requestQuit();
      return;
    }
    if (rendererRecoveryAttempts >= 2) {
      await dialog.showMessageBox(window, {
        type: "error",
        title: `${PRODUCT_NAME} renderer stopped`,
        message: "The workbench renderer stopped repeatedly.",
        detail: `Quit and restart KNOuX Forge. Diagnostics: ${logFile}`,
        buttons: ["Quit"],
        defaultId: 0,
        noLink: true,
      });
      await requestQuit();
      return;
    }
    rendererRecoveryAttempts += 1;
    const result = await dialog.showMessageBox(window, {
      type: "error",
      title: `${PRODUCT_NAME} renderer stopped`,
      message: "The workbench renderer stopped unexpectedly.",
      detail: "Reload the workbench to continue. If it stops again, quit and restart KNOuX Forge.",
      buttons: ["Reload Workbench", "Quit"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response !== 0) {
      await requestQuit();
      return;
    }
    try {
      window.reload();
    } catch (error) {
      writeLog("ERROR", `Renderer reload failed: ${describeFailure(error)}`);
      await requestQuit();
    }
  } finally {
    rendererRecoveryDialogOpen = false;
  }
}

function desktopMetadata() {
  return {
    product: PRODUCT_NAME,
    version: app.getVersion(),
    runtime: `Electron ${process.versions.electron}`,
    chromium: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    packaged: app.isPackaged,
    signature: "UNVERIFIED",
    signatureDetail: "Runtime self-verification is not performed; use scripts/verify-signing.mjs against the built artifact for Authenticode evidence.",
  };
}

function recordDesktopTraffic(details, error) {
  if (!productionServerModule || typeof productionServerModule.recordTopologyBrowserTraffic !== "function") return;
  try {
    productionServerModule.recordTopologyBrowserTraffic({
      url: details.url,
      sourceUrl: details.referrer || "",
      method: details.method,
      status: typeof details.statusCode === "number" ? details.statusCode : undefined,
      resourceType: details.resourceType,
      fromCache: details.fromCache === true,
      error,
    });
  } catch (captureError) {
    writeLog("WARN", `Preview browser traffic capture failed: ${captureError instanceof Error ? captureError.message : String(captureError)}`);
  }
}

function recordDesktopConsole(details) {
  if (!productionServerModule || typeof productionServerModule.recordPreviewBrowserConsole !== "function") return;
  try {
    productionServerModule.recordPreviewBrowserConsole({
      sourceUrl: typeof details.sourceId === "string" ? details.sourceId : "",
      level: details.level,
      message: typeof details.message === "string" ? details.message : "",
      lineNumber: typeof details.lineNumber === "number" ? details.lineNumber : undefined,
    });
  } catch (captureError) {
    writeLog("WARN", `Preview browser console capture failed: ${captureError instanceof Error ? captureError.message : String(captureError)}`);
  }
}

function createWindow() {
  const icon = path.join(applicationRoot, "dist", "spa", "favicon.ico");
  const primaryDisplay = screen.getPrimaryDisplay();
  const displays = [primaryDisplay, ...screen.getAllDisplays().filter((display) => display.id !== primaryDisplay.id)];
  const restored = ensureVisibleBounds(windowStateStore.load(), displays, primaryDisplay);
  const position = Number.isInteger(restored.x) && Number.isInteger(restored.y) ? { x: restored.x, y: restored.y } : {};
  mainWindow = new BrowserWindow({
    width: restored.width,
    height: restored.height,
    ...position,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    title: PRODUCT_NAME,
    icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
      webSecurity: true,
    },
  });
  if (restored.maximized) mainWindow.maximize();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const external = toSafeExternalHttpUrl(url);
    if (external) void shell.openExternal(external);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (productionServer && isTrustedKForgeOrigin(url, productionServer.url)) return;
    event.preventDefault();
    const external = toSafeExternalHttpUrl(url);
    if (external) void shell.openExternal(external);
  });
  // Electron 44 exposes console-message as one details object. Keeping this
  // listener single-argument avoids the deprecated legacy level/message/line/sourceId signature.
  mainWindow.webContents.on("console-message", (details) => recordDesktopConsole(details));
  mainWindow.webContents.on("render-process-gone", (_event, details) => { void handleRendererGone(details); });
  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  mainWindow.on("close", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const maximized = mainWindow.isMaximized();
    const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    windowStateStore.save({ ...bounds, maximized });
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  return mainWindow;
}

async function startLocalRuntime() {
  const modulePath = path.join(applicationRoot, "dist", "server", "productionServer.mjs");
  if (!fs.existsSync(modulePath)) throw new Error(`KForge desktop runtime is missing: ${modulePath}`);
  process.env.KFORGE_APP_ROOT = applicationRoot;
  process.env.KFORGE_WORKSPACE_ROOT = workspaceRoot;
  process.env.KFORGE_DESKTOP = "1";
  productionServerModule = await import(pathToFileURL(modulePath).href);
  productionServer = await productionServerModule.startKForgeProductionServer({ applicationRoot, host: "127.0.0.1", port: 0 });
  writeLog("INFO", `Loopback engine is ready at ${productionServer.url}.`);
}

async function stopLocalRuntime() {
  if (!productionServer) return;
  const current = productionServer;
  productionServer = null;
  await current.close();
  productionServerModule = null;
  writeLog("INFO", "Loopback engine and managed Preview and topology processes stopped.");
}

async function startApplication() {
  try {
    await startLocalRuntime();
    const window = createWindow();
    // Load the canonical "/" entry so the approved installation reveal journey
    // runs inside the installed app; the splash routes itself into /workspace.
    await window.loadURL(productionServer.url);
    writeLog("INFO", "KNOuX Forge window loaded.");
    if (process.env.KFORGE_DESKTOP_SMOKE === "1") {
      const requestedDelay = Number(process.env.KFORGE_DESKTOP_SMOKE_DELAY_MS || 1_500);
      const delayMs = Number.isFinite(requestedDelay) ? Math.min(120_000, Math.max(500, requestedDelay)) : 1_500;
      setTimeout(() => { void requestQuit(); }, delayMs).unref();
    }
  } catch (error) {
    startupError = error instanceof Error ? error.message : String(error);
    writeLog("ERROR", `Startup failed: ${startupError}`);
    await dialog.showMessageBox({
      type: "error",
      title: `${PRODUCT_NAME} could not start`,
      message: "The local KForge engine could not be initialized.",
      detail: `${redact(startupError)}\n\nDiagnostics: ${logFile}`,
    });
    await stopLocalRuntime().catch((shutdownError) => writeLog("ERROR", `Failed startup cleanup: ${shutdownError}`));
    isQuitting = true;
    app.quit();
  }
}

async function requestQuit() {
  if (isQuitting) return;
  isQuitting = true;
  writeLog("INFO", "KNOuX Forge shutdown requested.");
  try {
    await stopLocalRuntime();
  } catch (error) {
    writeLog("ERROR", `Shutdown cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.setName(PRODUCT_NAME);
  app.setAppUserModelId(APP_USER_MODEL_ID);
  app.setPath("userData", userDataRoot);
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });
  app.on("child-process-gone", (_event, details) => {
    if (!details || details.reason === "clean-exit") return;
    writeLog("WARN", `Child process gone: ${details.type || "unknown"} ${details.reason || "unknown"} (exitCode=${details.exitCode ?? "unknown"}).`);
  });
  app.on("before-quit", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      void requestQuit();
    }
  });
  app.on("window-all-closed", () => { void requestQuit(); });
  app.on("activate", () => {
    if (mainWindow || startupError) return;
    void startApplication();
  });

  const githubHandlers = [
    ["kforge:github-start", () => githubConnect.start()],
    ["kforge:github-status", () => githubConnect.status()],
    ["kforge:github-disconnect", () => githubConnect.disconnect()],
    ["kforge:github-installations", (page) => githubConnect.installations(page)],
    ["kforge:github-repositories", (installationId, page) => githubConnect.repositories(installationId, page)],
  ];
  for (const [channel, action] of githubHandlers) {
    ipcMain.handle(channel, (event, ...args) => {
      if (!DESKTOP_CHANNELS.has(event.channel) || !productionServer) throw new Error("Desktop IPC is not available.");
      const senderUrl = event.senderFrame && typeof event.senderFrame.url === "string" ? event.senderFrame.url : "";
      if (!isTrustedKForgeOrigin(senderUrl, productionServer.url)) throw new Error("Untrusted desktop sender.");
      return action(...args);
    });
  }

  ipcMain.handle("kforge:runtime", (event) => {
    if (!DESKTOP_CHANNELS.has(event.channel)) throw new Error("Desktop IPC channel is not allowed.");
    if (!productionServer) throw new Error("Desktop runtime metadata is unavailable before the local engine is ready.");
    const senderUrl = event.senderFrame && typeof event.senderFrame.url === "string" ? event.senderFrame.url : "";
    if (!isTrustedKForgeOrigin(senderUrl, productionServer.url)) throw new Error("Desktop IPC sender is not the trusted KForge origin.");
    return desktopMetadata();
  });

  app.whenReady().then(async () => {
    fs.mkdirSync(workspaceRoot, { recursive: true });
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const isLocalKForge = Boolean(productionServer) && isTrustedKForgeOrigin(details.url, productionServer.url);
      if (!isLocalKForge) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": ["default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-src http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"],
        },
      });
    });
    const trafficFilter = { urls: ["http://*/*", "https://*/*"] };
    session.defaultSession.webRequest.onCompleted(trafficFilter, (details) => recordDesktopTraffic(details));
    session.defaultSession.webRequest.onErrorOccurred(trafficFilter, (details) => recordDesktopTraffic(details, details.error || "request failed"));
    writeLog("INFO", `Starting ${PRODUCT_NAME} ${app.getVersion()} (${app.isPackaged ? "packaged" : "development"} runtime).`);
    Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate({
      productName: PRODUCT_NAME,
      about: () => { void showAbout(); },
      openDiagnostics: () => { void openDiagnosticsFolder(); },
      isDevelopment,
    })));
    await startApplication();
  });
}
