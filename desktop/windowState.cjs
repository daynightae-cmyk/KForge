const fs = require("fs");
const path = require("path");

const DEFAULT_WINDOW_STATE = Object.freeze({
  width: 1480,
  height: 920,
  x: null,
  y: null,
  maximized: false,
});

const MIN_WINDOW_WIDTH = 1024;
const MIN_WINDOW_HEIGHT = 720;
const MAX_WINDOW_DIMENSION = 16384;
const MIN_VISIBLE_WIDTH = 96;
const MIN_VISIBLE_HEIGHT = 48;

function finiteInteger(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function clampDimension(value, fallback, minimum) {
  const numeric = finiteInteger(value);
  if (numeric === null || numeric <= 0) return fallback;
  return Math.min(MAX_WINDOW_DIMENSION, Math.max(minimum, numeric));
}

function sanitizeWindowState(raw, fallback = DEFAULT_WINDOW_STATE) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    width: clampDimension(source.width, fallback.width, MIN_WINDOW_WIDTH),
    height: clampDimension(source.height, fallback.height, MIN_WINDOW_HEIGHT),
    x: finiteInteger(source.x),
    y: finiteInteger(source.y),
    maximized: source.maximized === true,
  };
}

function visibleArea(bounds, workArea) {
  const left = Math.max(bounds.x, workArea.x);
  const top = Math.max(bounds.y, workArea.y);
  const right = Math.min(bounds.x + bounds.width, workArea.x + workArea.width);
  const bottom = Math.min(bounds.y + bounds.height, workArea.y + workArea.height);
  return { width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * A restored position is only trusted while a meaningful part of the window
 * remains on an attached display. Monitors change, laptops undock, and a
 * window restored at stale coordinates would otherwise be unreachable.
 */
function ensureVisibleBounds(state, displays, primary = Array.isArray(displays) ? displays[0] : null) {
  const safe = sanitizeWindowState(state);
  const attached = Array.isArray(displays) ? displays.filter((display) => display && display.workArea) : [];
  const primaryArea = primary && primary.workArea ? primary.workArea : attached[0] && attached[0].workArea;
  if (!primaryArea) return safe;

  if (Number.isInteger(safe.x) && Number.isInteger(safe.y)) {
    const bounds = { x: safe.x, y: safe.y, width: safe.width, height: safe.height };
    const visible = attached.some((display) => {
      const area = visibleArea(bounds, display.workArea);
      return area.width >= MIN_VISIBLE_WIDTH && area.height >= MIN_VISIBLE_HEIGHT;
    });
    if (visible) return safe;
  }

  const width = Math.max(1, Math.min(safe.width, Math.round(primaryArea.width)));
  const height = Math.max(1, Math.min(safe.height, Math.round(primaryArea.height)));
  return {
    ...safe,
    width,
    height,
    x: Math.round(primaryArea.x + (primaryArea.width - width) / 2),
    y: Math.round(primaryArea.y + (primaryArea.height - height) / 2),
  };
}

/**
 * Window placement is convenience state, never product truth. A corrupt,
 * missing or unwritable file must degrade to the default window rather than
 * block startup.
 */
function createWindowStateStore(file, options = {}) {
  const io = options.fs || fs;
  return {
    file,
    load() {
      try {
        return sanitizeWindowState(JSON.parse(io.readFileSync(file, "utf8")));
      } catch {
        return { ...DEFAULT_WINDOW_STATE };
      }
    },
    save(state) {
      try {
        io.mkdirSync(path.dirname(file), { recursive: true });
        const safe = sanitizeWindowState(state);
        io.writeFileSync(file, `${JSON.stringify({ version: 1, ...safe }, null, 2)}\n`, "utf8");
        return true;
      } catch {
        return false;
      }
    },
  };
}

module.exports = {
  DEFAULT_WINDOW_STATE,
  createWindowStateStore,
  ensureVisibleBounds,
  sanitizeWindowState,
};
