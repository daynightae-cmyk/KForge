const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;

/**
 * Keeps the desktop diagnostic log bounded. One rotated backup is retained, so
 * a long-running or noisy Preview session cannot grow user data without limit.
 * Rotation is deliberately best-effort: diagnostics must never block the app.
 */
function createBoundedLogWriter(target, options = {}) {
  const configured = Number(options.maxBytes);
  const maxBytes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_LOG_BYTES;
  let bytes = 0;
  try {
    bytes = fs.statSync(target).size;
  } catch {
    bytes = 0;
  }

  return {
    target,
    maxBytes,
    write(value) {
      const line = String(value);
      const size = Buffer.byteLength(line, "utf8");
      if (bytes > 0 && bytes + size > maxBytes) {
        const rotated = `${target}.1`;
        try {
          fs.rmSync(rotated, { force: true });
          fs.renameSync(target, rotated);
        } catch {
          // Best-effort rotation; the append below still preserves the new line.
        }
        bytes = 0;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.appendFileSync(target, line, { encoding: "utf8" });
      bytes += size;
    },
  };
}

module.exports = { createBoundedLogWriter, DEFAULT_MAX_LOG_BYTES };
