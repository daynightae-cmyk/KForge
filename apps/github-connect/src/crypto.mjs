import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const pkceChallenge = (value) => createHash("sha256").update(value).digest("base64url");
export function safeEquals(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || !/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
export function webhookSignature(secret, payload) { return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex"); }
export function verifyWebhook(secret, payload, signature) {
  if (typeof secret !== "string" || secret.length < 32 || !Buffer.isBuffer(payload) || !/^sha256=[a-f0-9]{64}$/i.test(signature || "")) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(webhookSignature(secret, payload)));
}
export function encryptionKey(raw) {
  if (typeof raw !== "string" || !/^[0-9a-f]{64}$/i.test(raw)) throw new Error("KFORGE_SESSION_ENCRYPTION_KEY must be 64 hex digits");
  return Buffer.from(raw, "hex");
}
export function seal(key, value, aad) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(x => x.toString("base64url")).join(".");
}
export function unseal(key, value, aad) {
  if (typeof value !== "string" || value.length > 12000) throw new Error("Invalid encrypted session");
  const parts = value.split(".").map(x => Buffer.from(x, "base64url"));
  if (parts.length !== 3 || parts[0].length !== 12 || parts[1].length !== 16) throw new Error("Invalid encrypted session");
  const decipher = createDecipheriv("aes-256-gcm", key, parts[0]);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(parts[1]);
  return JSON.parse(Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString("utf8"));
}
