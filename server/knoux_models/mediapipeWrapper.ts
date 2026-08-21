import { spawn } from "child_process";
import path from "path";

export class MediapipeWrapper {
  modelPath: string;

  constructor(modelPath: string) {
    this.modelPath = modelPath;
  }

  async detectBody(imagePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.resolve(__dirname, "mediapipe_body_detection.py");
      const args = [
        "--input", imagePath,
        "--model_path", this.modelPath,
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
            reject(new Error(`Failed to parse Mediapipe output: ${parseError}`));
          }
        } else {
          reject(new Error(`Mediapipe process exited with code ${code}: ${error}`));
        }
      });
    });
  }

  async detectFaces(imagePath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.resolve(__dirname, "mediapipe_face_detection.py");
      const args = [
        "--input", imagePath,
        "--model_path", this.modelPath,
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
            reject(new Error(`Failed to parse Mediapipe face output: ${parseError}`));
          }
        } else {
          reject(new Error(`Mediapipe face process exited with code ${code}: ${error}`));
        }
      });
    });
  }

  async modifyBody(imagePath: string, modifications: any): Promise<string> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.resolve(__dirname, "mediapipe_body_modification.py");
      const outputPath = path.resolve(__dirname, "../tmp", `body_modified_${Date.now()}.png`);
      
      const args = [
        "--input", imagePath,
        "--output", outputPath,
        "--model_path", this.modelPath,
        "--modifications", JSON.stringify(modifications),
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
          resolve(outputPath);
        } else {
          reject(new Error(`Mediapipe body modification process exited with code ${code}: ${error}`));
        }
      });
    });
  }

  async trackBodyRealtime(videoPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.resolve(__dirname, "mediapipe_realtime_tracking.py");
      const outputPath = path.resolve(__dirname, "../tmp", `tracked_${Date.now()}.json`);
      
      const args = [
        "--input", videoPath,
        "--output", outputPath,
        "--model_path", this.modelPath,
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
          resolve(outputPath);
        } else {
          reject(new Error(`Mediapipe tracking process exited with code ${code}: ${error}`));
        }
      });
    });
  }
}
