import { describe, expect, it } from "vitest";
import { isSensitivePath, redactProjectText } from "./redaction";

describe("KForge redaction", () => {
  it("removes provider tokens, headers, cookies, connection secrets, private keys, and URL credentials", () => {
    const input = [
      "token=plain-secret",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      "Cookie: session=secret-cookie",
      "Server=db;User Id=admin;Password=database-secret;",
      "https://user:password@example.com/repository.git",
      "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
    ].join("\n");
    const result = redactProjectText("command-output", input);
    expect(result.redacted).toBe(true);
    expect(result.content).not.toContain("plain-secret");
    expect(result.content).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(result.content).not.toContain("secret-cookie");
    expect(result.content).not.toContain("database-secret");
    expect(result.content).not.toContain("user:password");
    expect(result.content).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
    expect(result.content).not.toContain("private-material");
    expect(result.reasons).toEqual(expect.arrayContaining(["secret-assignment", "private-key", "authorization-header", "cookie-header", "connection-string", "credentialed-url", "provider-token"]));
  });

  it("classifies sensitive path segments and bounds repeated bearer input", () => {
    expect(isSensitivePath("config/.env.production")).toBe(true);
    expect(isSensitivePath("config/service.key")).toBe(true);
    expect(isSensitivePath("config/environment.txt")).toBe(false);
    const token = "a".repeat(20_000);
    const result = redactProjectText("command-output", `Bearer ${token}`);
    expect(result.content).toBe("Bearer [REDACTED]");
    expect(result.reasons).toContain("bearer-token");
  });
});
