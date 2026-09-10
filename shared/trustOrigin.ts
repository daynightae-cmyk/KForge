export function isTrustedKForgeOrigin(candidateUrl: string, serverUrl: string): boolean {
  try {
    const candidate = new URL(candidateUrl);
    const server = new URL(serverUrl);
    if (candidate.username || candidate.password || server.username || server.password) return false;
    if (candidate.protocol !== server.protocol) return false;
    if (candidate.hostname !== server.hostname) return false;
    const candidatePort = candidate.port || (candidate.protocol === "https:" ? "443" : candidate.protocol === "http:" ? "80" : "");
    const serverPort = server.port || (server.protocol === "https:" ? "443" : server.protocol === "http:" ? "80" : "");
    if (candidatePort !== serverPort) return false;
    if (candidate.origin !== server.origin) return false;
    const allowedHosts = new Set(["127.0.0.1", "localhost"]);
    if (!allowedHosts.has(candidate.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}
