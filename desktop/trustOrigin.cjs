function isTrustedKForgeOrigin(candidateUrl, serverUrl) {
  try {
    const candidate = new URL(candidateUrl);
    const server = new URL(serverUrl);
    if (candidate.username || candidate.password || server.username || server.password) return false;
    if (candidate.protocol !== server.protocol) return false;
    if (candidate.hostname !== server.hostname) return false;
    const effectivePort = (value) => value.port || (value.protocol === "https:" ? "443" : value.protocol === "http:" ? "80" : "");
    if (effectivePort(candidate) !== effectivePort(server)) return false;
    if (candidate.origin !== server.origin) return false;
    const allowedHosts = new Set(["127.0.0.1", "localhost"]);
    if (!allowedHosts.has(candidate.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

module.exports = { isTrustedKForgeOrigin };
