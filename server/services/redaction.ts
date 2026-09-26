export interface RedactionResult {
  content: string;
  redacted: boolean;
  reasons: string[];
}

const secretAssignment = /((?:api[_-]?key|token|secret|password|passwd|credential|private[_-]?key)\s*[:=]\s*)([^\s,;]+)/gi;
const githubToken = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const authorizationHeader = /(Authorization\s*:\s*)([^\r\n]+)/gi;
const cookieHeader = /((?:Set-)?Cookie\s*:\s*)([^\r\n]+)/gi;
const connectionStringSecret = /((?:Password|Pwd|User Id|Uid)\s*=\s*)([^;\r\n]+)/gi;
const credentialedUrl = /\b([a-z][a-z0-9+.-]*:\/\/)([^:\s/@]+):([^@\s/]+)@/gi;

function redactPrivateKeyBlocks(value: string): { content: string; redacted: boolean } {
  let cursor = 0;
  let output = "";
  let redacted = false;
  while (cursor < value.length) {
    const begin = value.indexOf("-----BEGIN ", cursor);
    if (begin < 0) break;
    const beginMatch = /^-----BEGIN [A-Z ]*PRIVATE KEY-----/.exec(value.slice(begin));
    if (!beginMatch) {
      cursor = begin + "-----BEGIN ".length;
      continue;
    }
    const endSearch = value.indexOf("-----END ", begin + beginMatch[0].length);
    if (endSearch < 0) break;
    const endMatch = /^-----END [A-Z ]*PRIVATE KEY-----/.exec(value.slice(endSearch));
    if (!endMatch) {
      cursor = endSearch + "-----END ".length;
      continue;
    }
    output += `${value.slice(cursor, begin)}[REDACTED PRIVATE KEY]`;
    cursor = endSearch + endMatch[0].length;
    redacted = true;
  }
  return { content: output + value.slice(cursor), redacted };
}

function isBearerTokenCharacter(value: string) {
  return /[A-Za-z0-9._~+/=-]/.test(value);
}

function redactBearerTokens(value: string): { content: string; redacted: boolean } {
  const lower = value.toLowerCase();
  let cursor = 0;
  let output = "";
  let redacted = false;
  while (cursor < value.length) {
    const index = lower.indexOf("bearer", cursor);
    if (index < 0) break;
    const boundary = index === 0 || !/[A-Za-z0-9]/.test(value[index - 1]);
    let tokenStart = index + 6;
    while (tokenStart < value.length && /\s/.test(value[tokenStart])) tokenStart += 1;
    let tokenEnd = tokenStart;
    while (tokenEnd < value.length && isBearerTokenCharacter(value[tokenEnd])) tokenEnd += 1;
    if (boundary && tokenEnd - tokenStart >= 12) {
      output += `${value.slice(cursor, index)}Bearer [REDACTED]`;
      cursor = tokenEnd;
      redacted = true;
    } else {
      cursor = index + 6;
    }
  }
  return { content: output + value.slice(cursor), redacted };
}

export function isSensitivePath(filePath: string) {
  return filePath.replace(/\\/g, "/").split("/").some((segment) => segment === ".env" || segment.startsWith(".env.") || segment === "id_rsa" || segment === "id_dsa" || /\.(?:pem|key|p12|pfx)$/i.test(segment));
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
  const privateKeyResult = redactPrivateKeyBlocks(content);
  if (privateKeyResult.redacted) {
    reasons.push("private-key");
    content = privateKeyResult.content;
  }
  const bearerResult = redactBearerTokens(content);
  if (bearerResult.redacted) {
    reasons.push("bearer-token");
    content = bearerResult.content;
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
