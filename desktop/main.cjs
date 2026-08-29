const { app, BrowserWindow, dialog, ipcMain, shell, session } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const PRODUCT_NAME = "KNOuX Forge";
const DESKTOP_CHANNELS = new Set(["kforge:runtime"]);
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

let mainWindow = null;
let productionServer = null;
let isQuitting = false;
let startupError = null;

function redact(value) {
  return String(value)
    .replace(/(api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

function writeLog(level, message) {
  const line = `${new Date().toISOString()} [${level}] ${redact(message)}\n`;
  try {
    fs.mkdirSync(logsRoot, { recursive: true });
    fs.appendFileSync(logFile, line, { encoding: "utf8" });
  } catch {
    // Logging must never prevent the desktop product from opening.
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
    signature: "UNSIGNED",
  };
}

function createWindow() {
  const icon = path.join(applicationRoot, "dist", "spa", "favicon.ico");
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (productionServer && url.startsWith(productionServer.url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  return mainWindow;
}

async function startLocalRuntime() {
  const modulePath = path.join(applicationRoot, "dist", "server", "productionServer.mjs");
  if (!fs.existsSync(modulePath)) throw new Error(`KForge desktop runtime is missing: ${modulePath}`);
  process.env.KFORGE_APP_ROOT = applicationRoot;
  process.env.KFORGE_WORKSPACE_ROOT = workspaceRoot;
  process.env.KFORGE_DESKTOP = "1";
  const serverModule = await import(pathToFileURL(modulePath).href);
  productionServer = await serverModule.startKForgeProductionServer({ applicationRoot, host: "127.0.0.1", port: 0 });
  writeLog("INFO", `Loopback engine is ready at ${productionServer.url}.`);
}

async function stopLocalRuntime() {
  if (!productionServer) return;
  const current = productionServer;
  productionServer = null;
  await current.close();
  writeLog("INFO", "Loopback engine and managed Preview processes stopped.");
}

async function startApplication() {
  try {
    await startLocalRuntime();
    const window = createWindow();
    await window.loadURL(`${productionServer.url}/workspace`);
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
  app.setPath("userData", userDataRoot);
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
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

  ipcMain.handle("kforge:runtime", (event) => {
    if (!DESKTOP_CHANNELS.has(event.channel)) throw new Error("Desktop IPC channel is not allowed.");
    return desktopMetadata();
  });

  app.whenReady().then(async () => {
    fs.mkdirSync(workspaceRoot, { recursive: true });
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const isLocalKForge = productionServer && details.url.startsWith(productionServer.url);
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [isLocalKForge
            ? "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-src http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
            : "default-src 'none'"],
        },
      });
    });
    writeLog("INFO", `Starting ${PRODUCT_NAME} ${app.getVersion()} (${app.isPackaged ? "packaged" : "development"} runtime).`);
    await startApplication();
  });
}
