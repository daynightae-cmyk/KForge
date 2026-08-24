export interface RedactionResult {
  content: string;
  redacted: boolean;
  reasons: string[];
}

const secretAssignment = /((?:api[_-]?key|token|secret|password|passwd|credential|private[_-]?key)\s*[:=]\s*)([^\s,;]+)/gi;
const privateKeyBlock = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const bearerToken = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi;
const githubToken = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const authorizationHeader = /(Authorization\s*:\s*)([^\r\n]+)/gi;
const cookieHeader = /((?:Set-)?Cookie\s*:\s*)([^\r\n]+)/gi;
const connectionStringSecret = /((?:Password|Pwd|User Id|Uid)\s*=\s*)([^;\r\n]+)/gi;
const credentialedUrl = /\b([a-z][a-z0-9+.-]*:\/\/)([^:\s/@]+):([^@\s/]+)@/gi;

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
  if (githubToken.test(content)) {
    githubToken.lastIndex = 0;
    reasons.push("provider-token");
    content = content.replace(githubToken, "[REDACTED TOKEN]");
  }
  if (authorizationHeader.test(content)) {
    authorizationHeader.lastIndex = 0;
    reasons.push("authorization-header");
    content = content.replace(authorizationHeader, "$1[REDACTED]");
  }
  if (cookieHeader.test(content)) {
    cookieHeader.lastIndex = 0;
    reasons.push("cookie-header");
    content = content.replace(cookieHeader, "$1[REDACTED]");
  }
  if (connectionStringSecret.test(content)) {
    connectionStringSecret.lastIndex = 0;
    reasons.push("connection-string");
    content = content.replace(connectionStringSecret, "$1[REDACTED]");
  }
  if (credentialedUrl.test(content)) {
    credentialedUrl.lastIndex = 0;
    reasons.push("credentialed-url");
    content = content.replace(credentialedUrl, "$1[REDACTED]@");
  }
  return { content, redacted: reasons.length > 0, reasons };
}
