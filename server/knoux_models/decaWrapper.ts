import { spawn } from "child_process";
import path from "path";

export class DECAWrapper {
  modelPath: string;
  configPath: string;

  constructor(modelPath: string, configPath: string) {
    this.modelPath = modelPath;
    this.configPath = configPath;
  }

  async changeExpression(imagePath: string, expression: string, intensity: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.resolve(__dirname, "deca_inference.py");
      const args = [
        "--input", imagePath,
        "--model_path", this.modelPath,
        "--config_path", this.configPath,
        "--expression", expression,
        "--intensity", intensity.toString(),
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
          reject(new Error(`DECA process exited with code ${code}: ${error}`));
        }
      });
    });
  }

  async captureExpression(imagePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.resolve(__dirname, "deca_capture.py");
      const args = [
        "--input", imagePath,
        "--model_path", this.modelPath,
        "--config_path", this.configPath,
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
          try {
            const result = JSON.parse(output.trim());
            resolve(result);
          } catch (parseError) {
            reject(new Error(`Failed to parse DECA output: ${parseError}`));
          }
        } else {
          reject(new Error(`DECA process exited with code ${code}: ${error}`));
        }
      });
    });
  }
}
