import type { NextFunction, Request, Response } from "express";

/**
 * The packaged Electron shell applies this exact policy at the session
 * boundary. The standalone production browser runtime applies it here so the
 * same built SPA is served under the same script, frame and connection limits.
 * Development keeps Vite's HMR connections unrestricted.
 */
export const KFORGE_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "frame-src http://127.0.0.1:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const KFORGE_PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "hid=()",
  "bluetooth=()",
].join(", ");

export function kforgeSecurityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Content-Security-Policy", KFORGE_CONTENT_SECURITY_POLICY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", KFORGE_PERMISSIONS_POLICY);
  next();
}

/**
 * Terminal boundary for every unhandled route/service failure. Diagnostics stay
 * server-side; a hostile local caller receives neither a stack, an absolute
 * path, a request body nor a credential value. Errors that already carry a
 * deliberate 4xx status keep that status but still receive a generic body.
 */
export function kforgeTerminalErrorHandler(error: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(error);

  const status = errorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  console.error(`KForge request failed (${req.method} ${req.path}): ${message}`);

  return res.status(status).json({
    error: status >= 500 ? "KForge request failed." : "KForge rejected an invalid request.",
    code: status >= 500 ? "KFORGE_INTERNAL_ERROR" : "KFORGE_REQUEST_REJECTED",
  });
}

function errorStatus(error: unknown): number {
  if (typeof error !== "object" || error === null) return 500;
  const record = error as Record<string, unknown>;
  for (const key of ["status", "statusCode"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599) return value;
  }
  return 500;
}
