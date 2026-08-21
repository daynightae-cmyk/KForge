import express from "express";
import path from "path";
import { GFPGANWrapper } from "../knoux_models/gfpganWrapper";
import { BeautyGANWrapper } from "../knoux_models/beautyGANWrapper";
import { StyleGAN3Wrapper } from "../knoux_models/stylegan3Wrapper";
import { DECAWrapper } from "../knoux_models/decaWrapper";
import { Wav2LipWrapper } from "../knoux_models/wav2lipWrapper";
import { MediapipeWrapper } from "../knoux_models/mediapipeWrapper";

const router = express.Router();

// Keep model assets relative to the launched KForge project, which works in Vite and in the ESM production bundle.
const modelsRoot = path.resolve(process.cwd(), "server", "knoux_models");
const gfpganModelPath = path.join(modelsRoot, "gfpgan", "gfpgan.pth");
const beautyGANModelPath = path.join(modelsRoot, "beauty_gan", "beauty_gan.pth");
const styleGAN3ModelPath = path.join(modelsRoot, "stylegan3", "stylegan3.pkl");
const decaModelPath = path.join(modelsRoot, "deca", "deca.pkl");
const decaConfigPath = path.join(modelsRoot, "deca", "config.yaml");
const wav2lipModelPath = path.join(modelsRoot, "wav2lip", "wav2lip.pth");
const mediapipeModelPath = path.join(modelsRoot, "mediapipe");

const gfpgan = new GFPGANWrapper(gfpganModelPath);
const beautyGAN = new BeautyGANWrapper(beautyGANModelPath);
const styleGAN3 = new StyleGAN3Wrapper(styleGAN3ModelPath);
const deca = new DECAWrapper(decaModelPath, decaConfigPath);
const wav2lip = new Wav2LipWrapper(wav2lipModelPath);
const mediapipe = new MediapipeWrapper(mediapipeModelPath);

// GFPGAN Routes
router.post("/gfpgan/enhance", async (req, res) => {
  try {
    const { imagePath, enhancementLevel } = req.body;
    if (!imagePath || enhancementLevel === undefined) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    const result = await gfpgan.applyGFPGAN(imagePath, enhancementLevel);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// BeautyGAN Routes
router.post("/beautygan/makeup", async (req, res) => {
  try {
    const { imagePath, style, strength } = req.body;
    if (!imagePath || !style || strength === undefined) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    const result = await beautyGAN.applyMakeup(imagePath, style, strength);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// StyleGAN3 Routes
router.post("/stylegan3/morph", async (req, res) => {
  try {
    const { imagePath, parameters } = req.body;
    if (!imagePath || !parameters) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    const result = await styleGAN3.morphFace(imagePath, parameters);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DECA Routes
router.post("/deca/expression", async (req, res) => {
  try {
    const { imagePath, expression, intensity } = req.body;
    if (!imagePath || !expression || intensity === undefined) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    const result = await deca.changeExpression(imagePath, expression, intensity);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/deca/capture", async (req, res) => {
  try {
    const { imagePath } = req.body;
    if (!imagePath) {
      return res.status(400).json({ error: "Missing imagePath parameter" });
    }
    const result = await deca.captureExpression(imagePath);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Wav2Lip Routes
router.post("/wav2lip/sync", async (req, res) => {
  try {
    const { videoPath, audioPath } = req.body;
    if (!videoPath || !audioPath) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    const result = await wav2lip.generateLipSync(videoPath, audioPath);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/wav2lip/sync-multi", async (req, res) => {
  try {
    const { videoPath, audioPath, faceIndices } = req.body;
    if (!videoPath || !audioPath || !faceIndices) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    const result = await wav2lip.generateLipSyncMultipleFaces(videoPath, audioPath, faceIndices);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mediapipe Routes
router.post("/mediapipe/detect-body", async (req, res) => {
  try {
    const { imagePath } = req.body;
    if (!imagePath) {
      return res.status(400).json({ error: "Missing imagePath parameter" });
    }
    const result = await mediapipe.detectBody(imagePath);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/mediapipe/detect-faces", async (req, res) => {
  try {
    const { imagePath } = req.body;
    if (!imagePath) {
      return res.status(400).json({ error: "Missing imagePath parameter" });
    }
    const result = await mediapipe.detectFaces(imagePath);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/mediapipe/modify-body", async (req, res) => {
  try {
    const { imagePath, modifications } = req.body;
    if (!imagePath || !modifications) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    const result = await mediapipe.modifyBody(imagePath, modifications);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/mediapipe/track-realtime", async (req, res) => {
  try {
    const { videoPath } = req.body;
    if (!videoPath) {
      return res.status(400).json({ error: "Missing videoPath parameter" });
    }
    const result = await mediapipe.trackBodyRealtime(videoPath);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
