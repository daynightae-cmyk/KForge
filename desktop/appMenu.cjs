const APP_USER_MODEL_ID = "com.daynightdeliveryservices.knouxforge";

/**
 * Production keeps native editing, zoom and fullscreen roles, the About dialog
 * and the diagnostics folder. Reload and DevTools exist only in development,
 * so a packaged workbench does not present developer-only shell controls.
 */
function createApplicationMenuTemplate({ productName, about, openDiagnostics, isDevelopment = false }) {
  const viewItems = [
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
  if (isDevelopment) {
    viewItems.push({ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" });
  }

  const helpItems = [];
  if (typeof about === "function") helpItems.push({ label: `About ${productName}`, click: about });
  if (typeof openDiagnostics === "function") helpItems.push({ label: "Open Diagnostics Folder", click: openDiagnostics });

  const template = [
    { role: "editMenu" },
    { label: "View", submenu: viewItems },
  ];
  if (helpItems.length) template.push({ label: "Help", submenu: helpItems });
  return template;
}

module.exports = { APP_USER_MODEL_ID, createApplicationMenuTemplate };
