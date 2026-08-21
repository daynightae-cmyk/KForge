import { spawn } from "child_process";
import path from "path";

export class BeautyGANWrapper {
  modelPath: string;

  constructor(modelPath: string) {
    this.modelPath = modelPath;
  }

  async applyMakeup(imagePath: string, style: string, strength: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.resolve(__dirname, "beautygan_inference.py");
      const process = spawn("python3", [pythonScript, "--input", imagePath, "--style", style, "--strength", strength.toString(), "--model_path", this.modelPath]);

      let output = "";
      let error = "";

      process.stdout.on("data", (data) => {
        output += data.toString();
      });

      process.stderr.on("data", (data) => {
        error += data.toString();
      });

      process.on("close", (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`BeautyGAN process exited with code ${code}: ${error}`));
        }
      });
    });
  }
}
