// Configuration for AI models used in Knoux Edita PRO
// These would normally be loaded from local model files

export interface AIModelConfig {
  id: string;
  name: string;
  version: string;
  modelPath: string;
  configPath?: string;
  weightsPath?: string;
  isLocal: boolean;
  capabilities: string[];
  performance: {
    cpu: "low" | "medium" | "high";
    gpu: "low" | "medium" | "high";
    memory: number; // MB
  };
  supportedFormats: string[];
}

export const AI_MODELS: Record<string, AIModelConfig> = {
  GFPGAN: {
    id: "gfpgan",
    name: "GFPGAN Face Enhancement",
    version: "1.3.8",
    modelPath: "./knoux_models/gfpgan/gfpgan.pth",
    isLocal: true,
    capabilities: [
      "face-enhancement",
      "skin-smoothing",
      "detail-restoration",
      "imperfection-removal",
    ],
    performance: {
      cpu: "medium",
      gpu: "high",
      memory: 512,
    },
    supportedFormats: ["jpg", "png", "bmp", "tiff"],
  },

  BEAUTY_GAN: {
    id: "beauty-gan",
    name: "BeautyGAN Makeup Application",
    version: "2.1.0",
    modelPath: "./knoux_models/beauty_gan/beauty_gan.pth",
    isLocal: true,
    capabilities: [
      "makeup-application",
      "lipstick",
      "eye-makeup",
      "foundation",
      "blush",
    ],
    performance: {
      cpu: "medium",
      gpu: "high",
      memory: 768,
    },
    supportedFormats: ["jpg", "png"],
  },

  DECA: {
    id: "deca",
    name: "DECA Expression Control",
    version: "1.0.0",
    modelPath: "./knoux_models/deca/deca.pkl",
    configPath: "./knoux_models/deca/config.yaml",
    isLocal: true,
    capabilities: [
      "expression-editing",
      "face-reenactment",
      "emotion-transfer",
      "3d-face-reconstruction",
    ],
    performance: {
      cpu: "high",
      gpu: "high",
      memory: 1024,
    },
    supportedFormats: ["jpg", "png", "mp4"],
  },

  WAV2LIP: {
    id: "wav2lip",
    name: "Wav2Lip Synchronization",
    version: "1.1.0",
    modelPath: "./knoux_models/wav2lip/wav2lip.pth",
    isLocal: true,
    capabilities: ["lip-sync", "audio-visual-sync", "mouth-animation"],
    performance: {
      cpu: "high",
      gpu: "medium",
      memory: 896,
    },
    supportedFormats: ["mp4", "avi", "mov", "wav", "mp3"],
  },

  STYLEGAN3: {
    id: "stylegan3",
    name: "StyleGAN3 Face Morphing",
    version: "3.0.0",
    modelPath: "./knoux_models/stylegan3/stylegan3.pkl",
    isLocal: true,
    capabilities: [
      "face-morphing",
      "feature-editing",
      "age-progression",
      "gender-swap",
    ],
    performance: {
      cpu: "high",
      gpu: "high",
      memory: 2048,
    },
    supportedFormats: ["jpg", "png"],
  },

  MEDIAPIPE: {
    id: "mediapipe",
    name: "MediaPipe Body Tracking",
    version: "0.10.9",
    modelPath: "./knoux_models/mediapipe/",
    isLocal: true,
    capabilities: [
      "pose-detection",
      "hand-tracking",
      "face-mesh",
      "body-segmentation",
      "real-time-tracking",
    ],
    performance: {
      cpu: "low",
      gpu: "medium",
      memory: 256,
    },
    supportedFormats: ["jpg", "png", "mp4", "webm"],
  },
};

export interface AIProcessingSettings {
  enableGPUAcceleration: boolean;
  maxConcurrentTasks: number;
  priorityQueue: boolean;
  lowMemoryMode: boolean;
  realTimeProcessing: boolean;
  cacheResults: boolean;
  maxCacheSize: number; // MB
}

export const DEFAULT_AI_SETTINGS: AIProcessingSettings = {
  enableGPUAcceleration: true,
  maxConcurrentTasks: 3,
  priorityQueue: true,
  lowMemoryMode: false,
  realTimeProcessing: true,
  cacheResults: true,
  maxCacheSize: 1024,
};

// Preset configurations for different hardware capabilities
export const HARDWARE_PRESETS = {
  LOW_END: {
    ...DEFAULT_AI_SETTINGS,
    enableGPUAcceleration: false,
    maxConcurrentTasks: 1,
    lowMemoryMode: true,
    realTimeProcessing: false,
    maxCacheSize: 256,
  },

  MEDIUM: {
    ...DEFAULT_AI_SETTINGS,
    maxConcurrentTasks: 2,
    maxCacheSize: 512,
  },

  HIGH_END: {
    ...DEFAULT_AI_SETTINGS,
    maxConcurrentTasks: 6,
    maxCacheSize: 2048,
  },

  ULTRA: {
    ...DEFAULT_AI_SETTINGS,
    maxConcurrentTasks: 8,
    maxCacheSize: 4096,
  },
};

// Face enhancement presets
export const FACE_ENHANCEMENT_PRESETS = {
  NATURAL: {
    skinSmoothing: 0.3,
    eyeEnhancement: 0.2,
    teethWhitening: 0.1,
    overall: 0.4,
  },

  MODERATE: {
    skinSmoothing: 0.6,
    eyeEnhancement: 0.4,
    teethWhitening: 0.3,
    overall: 0.6,
  },

  STRONG: {
    skinSmoothing: 0.8,
    eyeEnhancement: 0.7,
    teethWhitening: 0.5,
    overall: 0.8,
  },

  MAXIMUM: {
    skinSmoothing: 1.0,
    eyeEnhancement: 1.0,
    teethWhitening: 0.8,
    overall: 1.0,
  },
};

// Makeup style presets
export const MAKEUP_PRESETS = {
  NATURAL: {
    foundation: { intensity: 0.3, coverage: "light" },
    eyes: { intensity: 0.2, style: "subtle" },
    lips: { intensity: 0.3, color: "nude" },
    blush: { intensity: 0.2, placement: "natural" },
  },

  PARTY: {
    foundation: { intensity: 0.6, coverage: "medium" },
    eyes: { intensity: 0.8, style: "dramatic" },
    lips: { intensity: 0.7, color: "bold" },
    blush: { intensity: 0.4, placement: "defined" },
  },

  WEDDING: {
    foundation: { intensity: 0.7, coverage: "full" },
    eyes: { intensity: 0.6, style: "elegant" },
    lips: { intensity: 0.5, color: "classic" },
    blush: { intensity: 0.3, placement: "soft" },
  },

  FANTASY: {
    foundation: { intensity: 0.5, coverage: "medium" },
    eyes: { intensity: 1.0, style: "creative" },
    lips: { intensity: 0.9, color: "fantasy" },
    blush: { intensity: 0.6, placement: "artistic" },
  },

  KPOP: {
    foundation: { intensity: 0.8, coverage: "full" },
    eyes: { intensity: 0.9, style: "kpop" },
    lips: { intensity: 0.6, color: "gradient" },
    blush: { intensity: 0.5, placement: "youthful" },
  },
};

// Expression presets
export const EXPRESSION_PRESETS = {
  HAPPY: {
    mouth: 0.8,
    eyes: 0.6,
    eyebrows: 0.3,
    cheeks: 0.7,
  },

  SAD: {
    mouth: -0.6,
    eyes: -0.4,
    eyebrows: -0.5,
    cheeks: -0.3,
  },

  SURPRISED: {
    mouth: 0.4,
    eyes: 0.9,
    eyebrows: 0.8,
    cheeks: 0.2,
  },

  ANGRY: {
    mouth: -0.3,
    eyes: -0.2,
    eyebrows: -0.8,
    cheeks: 0.1,
  },

  NEUTRAL: {
    mouth: 0.0,
    eyes: 0.0,
    eyebrows: 0.0,
    cheeks: 0.0,
  },
};

// Export utility functions
export function getModelById(modelId: string): AIModelConfig | undefined {
  return AI_MODELS[modelId.toUpperCase()];
}

export function getModelsByCapability(capability: string): AIModelConfig[] {
  return Object.values(AI_MODELS).filter((model) =>
    model.capabilities.includes(capability),
  );
}

export function estimateMemoryUsage(modelIds: string[]): number {
  return modelIds.reduce((total, id) => {
    const model = getModelById(id);
    return total + (model?.performance.memory || 0);
  }, 0);
}

export function getOptimalSettings(
  availableMemory: number,
): AIProcessingSettings {
  if (availableMemory < 4096) return HARDWARE_PRESETS.LOW_END;
  if (availableMemory < 8192) return HARDWARE_PRESETS.MEDIUM;
  if (availableMemory < 16384) return HARDWARE_PRESETS.HIGH_END;
  return HARDWARE_PRESETS.ULTRA;
}
