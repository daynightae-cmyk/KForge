import path from "path";
import { startKForgeProductionServer } from "./productionServer";

const applicationRoot = path.resolve(process.env.KFORGE_APP_ROOT || path.resolve(import.meta.dirname, "../.."));
const port = Number(process.env.PORT || 3000);

const runtime = await startKForgeProductionServer({ applicationRoot, host: "127.0.0.1", port });
console.log(`KForge Workspace running at ${runtime.url}`);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  try {
    await runtime.close();
    console.log(`KForge Workspace stopped after ${signal}.`);
    process.exit(0);
  } catch (error: unknown) {
    console.error(`KForge Workspace could not stop cleanly after ${signal}:`, error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });
