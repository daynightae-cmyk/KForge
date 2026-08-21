import { spawn } from "child_process";
import path from "path";

export class StyleGAN3Wrapper {
  modelPath: string;

  constructor(modelPath: string) {
    this.modelPath = modelPath;
  }

  async morphFace(imagePath: string, parameters: any): Promise<string> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.resolve(__dirname, "stylegan3_inference.py");
      const args = [
        "--input", imagePath,
        "--model_path", this.modelPath,
        "--params", JSON.stringify(parameters),
      ];
      const process = spawn("python3", [pythonScript, ...args]);

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
          reject(new Error(`StyleGAN3 process exited with code ${code}: ${error}`));
        }
      });
    });
  }
}
