import { promises as fs } from "fs";
import path from "path";

const root = process.cwd();
const logoPath = path.join(root, "client", "assets", "knoux-forge-official-logo.png");
const retiredReferencePath = path.join(root, "client", "assets", "knoux-forge-installation-reference.png");
const logoBudgetBytes = 1_050_000;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (await exists(retiredReferencePath)) {
  console.error("KForge asset budget verification: FAIL");
  console.error("The retired installation reference image returned to client/assets even though it has no runtime consumer.");
  process.exit(1);
}

const logo = await fs.readFile(logoPath);
if (logo.length > logoBudgetBytes) {
  console.error("KForge asset budget verification: FAIL");
  console.error(`Official logo is ${logo.length} bytes; budget is ${logoBudgetBytes} bytes.`);
  process.exit(1);
}

if (!logo.subarray(0, pngSignature.length).equals(pngSignature)) {
  console.error("KForge asset budget verification: FAIL");
  console.error("Official logo no longer has a valid PNG signature.");
  process.exit(1);
}

console.log(`KForge asset budget verification: PASS (official logo ${logo.length}/${logoBudgetBytes} bytes; retired reference absent).`);
