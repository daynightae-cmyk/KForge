import { promises as fs } from "fs";
import path from "path";

const root = process.cwd();
const logoPath = path.join(root, "client", "assets", "knoux-forge-official-logo.png");
const retiredReferencePath = path.join(root, "client", "assets", "knoux-forge-installation-reference.png");
const logoBudgetBytes = 1_050_000;
const revealAudioPath = path.join(root, "public", "audio", "logo-reveal-slow.ogg");
const retiredRevealWavPath = path.join(root, "public", "audio", "logo-reveal-slow.wav");
const revealAudioBudgetBytes = 250_000;
const oggSignature = Buffer.from("OggS", "ascii");
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

if (await exists(retiredRevealWavPath)) {
  console.error("KForge asset budget verification: FAIL");
  console.error("The retired PCM reveal WAV returned after Opus migration.");
  process.exit(1);
}

const revealAudio = await fs.readFile(revealAudioPath);
if (revealAudio.length > revealAudioBudgetBytes) {
  console.error("KForge asset budget verification: FAIL");
  console.error(`Reveal audio is ${revealAudio.length} bytes; budget is ${revealAudioBudgetBytes} bytes.`);
  process.exit(1);
}

if (!revealAudio.subarray(0, oggSignature.length).equals(oggSignature)) {
  console.error("KForge asset budget verification: FAIL");
  console.error("Reveal audio no longer has a valid OGG container signature.");
  process.exit(1);
}

const installationSource = await fs.readFile(path.join(root, "client", "pages", "KnouxForgeInstallation.tsx"), "utf8");
if (!installationSource.includes("/audio/logo-reveal-slow.ogg") || installationSource.includes("/audio/logo-reveal-slow.wav")) {
  console.error("KForge asset budget verification: FAIL");
  console.error("Installation runtime must reference only the compact Opus reveal asset.");
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

console.log(`KForge asset budget verification: PASS (official logo ${logo.length}/${logoBudgetBytes} bytes; reveal audio ${revealAudio.length}/${revealAudioBudgetBytes} bytes; retired reference/WAV absent).`);
