export interface RedactionResult {
  content: string;
  redacted: boolean;
  reasons: string[];
}

const secretAssignment = /((?:api[_-]?key|token|secret|password|passwd|credential|private[_-]?key)\s*[:=]\s*)([^\s,;]+)/gi;
const privateKeyBlock = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const bearerToken = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi;

export function isSensitivePath(filePath: string) {
  return /(^|[\\/])\.env(?:\.|$)|(^|[\\/])(?:id_rsa|id_dsa|.*\.pem|.*\.key|.*\.p12|.*\.pfx)$/i.test(filePath);
}

export function redactProjectText(filePath: string, text: string): RedactionResult {
  const reasons: string[] = [];
  let content = text;
  if (isSensitivePath(filePath)) {
    reasons.push("sensitive-path");
    content = content.split(/\r?\n/).map((line) => {
      const key = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
      return key ? `${key}=[REDACTED]` : line;
    }).join("\n");
  }
  if (secretAssignment.test(content)) {
    secretAssignment.lastIndex = 0;
    reasons.push("secret-assignment");
    content = content.replace(secretAssignment, "$1[REDACTED]");
  }
  if (privateKeyBlock.test(content)) {
    privateKeyBlock.lastIndex = 0;
    reasons.push("private-key");
    content = content.replace(privateKeyBlock, "[REDACTED PRIVATE KEY]");
  }
  if (bearerToken.test(content)) {
    bearerToken.lastIndex = 0;
    reasons.push("bearer-token");
    content = content.replace(bearerToken, "Bearer [REDACTED]");
  }
  return { content, redacted: reasons.length > 0, reasons };
}
