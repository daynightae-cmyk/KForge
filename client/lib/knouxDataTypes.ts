export interface KnouxProjectState {
  id: string;
  name: string;
  timeline: KnouxTimeline;
  settings: KnouxProjectSettings;
  metadata: KnouxProjectMetadata;
}

export interface KnouxTimeline {
  duration: number; // in seconds
  currentTime: number;
  tracks: KnouxTrack[];
  zoom: number;
  playheadPosition: number;
}

export interface KnouxTrack {
  id: string;
  name: string;
  type: KnouxTrackType;
  clips: KnouxClipData[];
  muted: boolean;
  locked: boolean;
  height: number;
}

export type KnouxTrackType = "video" | "audio" | "text" | "effect" | "ai-layer";

export interface KnouxClipData {
  id: string;
  name: string;
  type: KnouxClipType;
  startTime: number;
  duration: number;
  properties: KnouxClipProperties;
  aiSettings?: KnouxAISettings;
  source?: KnouxMediaSource;
}

export type KnouxClipType =
  | "video-clip"
  | "audio-clip"
  | "image-clip"
  | "text-clip"
  | "ai-generated"
  | "face-fx"
  | "body-fx";

export interface KnouxClipProperties {
  transform: KnouxTransform;
  effects: KnouxEffect[];
  opacity: number;
  blendMode: string;
  aiSettings?: KnouxAISettings;
}

export interface KnouxTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface KnouxEffect {
  id: string;
  type: string;
  enabled: boolean;
  parameters: Record<string, any>;
}

export interface KnouxAISettings {
  faceFX?: KnouxFaceFXSettings;
  bodyFX?: KnouxBodyFXSettings;
  makeupFX?: KnouxMakeupSettings;
  lipSync?: KnouxLipSyncSettings;
  expression?: KnouxExpressionSettings;
}

export interface KnouxFaceFXSettings {
  enabled: boolean;
  faceIndex: number;
  enhancement: {
    level: number; // 0-1
    skinSmoothing: number;
    eyeEnhancement: number;
    teethWhitening: number;
  };
  morphing: {
    eyeSize: number; // 0.5-2.0
    noseSize: number;
    faceWidth: number;
    smileIntensity: number;
  };
  beautification: {
    skinTone: "light" | "medium" | "dark" | "auto";
    removeImperfections: boolean;
    sharpenDetails: boolean;
  };
}

export interface KnouxBodyFXSettings {
  enabled: boolean;
  bodyType: "male" | "female" | "auto";
  modifications: {
    shoulderWidth: number; // 0.5-2.0
    waistSize: number;
    height: number;
    legLength: number;
  };
  presets: "slim" | "sport" | "fashion" | "natural";
}

export interface KnouxMakeupSettings {
  enabled: boolean;
  style: "natural" | "party" | "wedding" | "fantasy" | "kpop";
  intensity: number; // 0-1
  components: {
    eyes: { enabled: boolean; intensity: number; color?: string };
    lips: { enabled: boolean; intensity: number; color?: string };
    cheeks: { enabled: boolean; intensity: number; color?: string };
    eyebrows: { enabled: boolean; intensity: number };
    foundation: { enabled: boolean; intensity: number };
  };
}

export interface KnouxLipSyncSettings {
  enabled: boolean;
  audioSource: string;
  accuracy: "fast" | "balanced" | "high";
  faceIndex: number;
}

export interface KnouxExpressionSettings {
  enabled: boolean;
  mood: "happy" | "sad" | "surprised" | "angry" | "neutral" | "custom";
  intensity: number;
  components: {
    eyebrows: number;
    eyes: number;
    mouth: number;
    cheeks: number;
  };
}

export interface KnouxMediaSource {
  type: "file" | "camera" | "screen" | "generated";
  path?: string;
  url?: string;
  metadata?: {
    width: number;
    height: number;
    duration?: number;
    frameRate?: number;
    fileSize?: number;
  };
}

export interface KnouxProjectSettings {
  resolution: {
    width: number;
    height: number;
  };
  frameRate: number;
  audioSampleRate: number;
  colorSpace: string;
  language: "ar" | "en";
  theme: "dark" | "light";
  aiProcessing: {
    enableLocalProcessing: boolean;
    gpuAcceleration: boolean;
    maxConcurrentTasks: number;
  };
}

export interface KnouxProjectMetadata {
  createdAt: string;
  modifiedAt: string;
  version: string;
  author: string;
  description?: string;
  tags: string[];
}

export interface KnouxGenerativeTemplate {
  id: string;
  name: string;
  description: string;
  category:
    | "birthday"
    | "wedding"
    | "travel"
    | "business"
    | "social"
    | "custom";
  thumbnailUrl: string;
  duration: number;
  tracks: KnouxTrack[];
  aiPrompt?: string;
  customizations: {
    colors: string[];
    fonts: string[];
    musicStyle?: string;
  };
}

export type KnouxLayerType =
  | "video"
  | "audio"
  | "text"
  | "image"
  | "ai-face-fx"
  | "ai-body-fx"
  | "ai-makeup"
  | "ai-generated-content";

export interface KnouxAIAnalysisResult {
  faceDetection: {
    faces: Array<{
      id: string;
      boundingBox: { x: number; y: number; width: number; height: number };
      confidence: number;
      landmarks: Array<{ x: number; y: number }>;
      attributes: {
        age?: number;
        gender?: "male" | "female";
        emotion?: string;
        skinTone?: string;
      };
    }>;
  };
  objectDetection: {
    objects: Array<{
      id: string;
      type: string;
      boundingBox: { x: number; y: number; width: number; height: number };
      confidence: number;
    }>;
  };
  sceneAnalysis: {
    setting: string;
    lighting: "natural" | "artificial" | "mixed" | "low";
    mood: string;
    colorPalette: string[];
  };
}
