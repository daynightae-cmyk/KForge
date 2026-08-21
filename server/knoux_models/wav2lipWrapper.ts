import { spawn } from "child_process";
import path from "path";

export class Wav2LipWrapper {
  modelPath: string;

  constructor(modelPath: string) {
    this.modelPath = modelPath;
  }

  async generateLipSync(videoPath: string, audioPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.resolve(__dirname, "wav2lip_inference.py");
      const outputPath = path.resolve(__dirname, "../tmp", `lipsync_${Date.now()}.mp4`);
      
      const args = [
        "--checkpoint_path", this.modelPath,
        "--face", videoPath,
        "--audio", audioPath,
        "--outfile", outputPath,
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
          reject(new Error(`Wav2Lip process exited with code ${code}: ${error}`));
        }
      });
    });
  }

  async generateLipSyncMultipleFaces(videoPath: string, audioPath: string, faceIndices: number[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.resolve(__dirname, "wav2lip_multiface.py");
      const outputPath = path.resolve(__dirname, "../tmp", `lipsync_multi_${Date.now()}.mp4`);
      
      const args = [
        "--checkpoint_path", this.modelPath,
        "--face", videoPath,
        "--audio", audioPath,
        "--outfile", outputPath,
        "--face_indices", faceIndices.join(","),
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
          reject(new Error(`Wav2Lip multiface process exited with code ${code}: ${error}`));
        }
      });
    });
  }
}
