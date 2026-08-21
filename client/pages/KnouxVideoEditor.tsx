import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { KnouxHeader } from "@/components/knoux/KnouxHeader";
import { KnouxSidebar } from "@/components/knoux/KnouxSidebar";
import { KnouxPreview } from "@/components/knoux/KnouxPreview";
import { KnouxTimeline } from "@/components/knoux/KnouxTimeline";
import { KnouxInspectorPanel } from "@/components/knoux/KnouxInspectorPanel";
import { KnouxProjectState } from "@/lib/knouxDataTypes";
import { KNOUX_BRANDING } from "@/lib/knouxBrandingConstants";

export default function KnouxVideoEditor() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(80);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [projectState, setProjectState] = useState<Partial<KnouxProjectState>>({
    id: "demo-project",
    name: "My Amazing Video",
    timeline: {
      duration: 100,
      currentTime: 0,
      tracks: [],
      zoom: 1,
      playheadPosition: 0,
    },
    settings: {
      resolution: { width: 1920, height: 1080 },
      frameRate: 60,
      audioSampleRate: 48000,
      colorSpace: "Rec.709",
      language: "ar",
      theme: "dark",
      aiProcessing: {
        enableLocalProcessing: true,
        gpuAcceleration: true,
        maxConcurrentTasks: 4,
      },
    },
  });

  const handlePlayPause = useCallback(() => {
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleSeek = useCallback((time: number) => {
    setCurrentTime(time);
    setProjectState((prev) => ({
      ...prev,
      timeline: {
        ...prev.timeline!,
        currentTime: time,
        playheadPosition: time,
      },
    }));
  }, []);

  const handleVolumeChange = useCallback((newVolume: number) => {
    setVolume(newVolume);
  }, []);

  const handleClipSelect = useCallback((clipId: string) => {
    setSelectedClipId(clipId);
  }, []);

  const handlePropertyChange = useCallback(
    (property: string, value: any) => {
      // Handle property changes for selected clip
      console.log("Property change:", property, value);
      // In a real implementation, this would update the clip properties
    },
    [selectedClipId],
  );

  const handleSave = useCallback(() => {
    console.log("Saving project...");
    // Implement save functionality
  }, []);

  const handleOpen = useCallback(() => {
    console.log("Opening project...");
    // Implement open functionality
  }, []);

  const handleExport = useCallback(() => {
    console.log("Exporting project...");
    // Implement export functionality
  }, []);

  const handleUndo = useCallback(() => {
    console.log("Undo...");
    // Implement undo functionality
  }, []);

  const handleRedo = useCallback(() => {
    console.log("Redo...");
    // Implement redo functionality
  }, []);

  const selectedClip = selectedClipId
    ? projectState.timeline?.tracks
        ?.flatMap((track) => track.clips)
        ?.find((clip) => clip.id === selectedClipId)
    : {
        // Mock selected clip for demonstration
        id: "demo-clip-1",
        name: "Demo Video Clip",
        type: "video-clip" as const,
        startTime: 0,
        duration: 30,
        properties: {
          transform: {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
          },
          effects: [],
          opacity: 1,
          blendMode: "normal" as const,
        },
        aiSettings: {
          faceFX: {
            enabled: true,
            faceIndex: 0,
            enhancement: {
              level: 0.7,
              skinSmoothing: 0.8,
              eyeEnhancement: 0.6,
              teethWhitening: 0.5,
            },
            morphing: {
              eyeSize: 1.2,
              noseSize: 0.9,
              faceWidth: 0.95,
              smileIntensity: 1.1,
            },
            beautification: {
              skinTone: "auto",
              removeImperfections: true,
              sharpenDetails: true,
            },
          },
          bodyTracking: {
            enabled: true,
            trackingPoints: [],
            smoothing: 0.8,
          },
        },
      };

  return (
    <div className="h-screen w-screen bg-background overflow-hidden flex flex-col">
      {/* Header */}
      <KnouxHeader
        isPlaying={isPlaying}
        onPlayPause={handlePlayPause}
        onSave={handleSave}
        onOpen={handleOpen}
        onExport={handleExport}
        onUndo={handleUndo}
        onRedo={handleRedo}
        projectName={projectState.name}
      />

      {/* Main Content - Fixed Layout Structure */}
      <main className="flex-1 grid grid-cols-[320px_1fr_350px] grid-rows-[1fr_280px] gap-2 p-2 overflow-hidden">
        {/* Sidebar Component (Col 1, Spans both rows) */}
        <div className="row-span-2">
          <KnouxSidebar />
        </div>

        {/* Preview Component (Col 2, Row 1) */}
        <div className="knoux-glass-panel">
          <KnouxPreview
            currentTime={currentTime}
            duration={projectState.timeline?.duration || 100}
            isPlaying={isPlaying}
            onPlayPause={handlePlayPause}
            onSeek={handleSeek}
            onVolumeChange={handleVolumeChange}
            volume={volume}
          />
        </div>

        {/* Inspector Panel Component (Col 3, Spans both rows) */}
        <div className="row-span-2">
          <KnouxInspectorPanel
            selectedClip={selectedClip}
            onPropertyChange={handlePropertyChange}
          />
        </div>

        {/* Timeline Component (Col 2, Row 2) */}
        <div className="knoux-glass-panel">
          <KnouxTimeline
            projectState={projectState}
            onClipSelect={handleClipSelect}
            onTimelineSeek={handleSeek}
            selectedClipId={selectedClipId || undefined}
          />
        </div>
      </main>

      {/* Loading Overlay for AI Processing */}
      <motion.div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0 }}
        style={{ pointerEvents: "none" }}
      >
        <motion.div
          className="knoux-glass-panel p-8 text-center"
          animate={{
            scale: [1, 1.05, 1],
            opacity: [0.8, 1, 0.8],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <div className="knoux-ai-indicator mb-4">
            <span className="text-lg">🤖</span>
            AI Processing
          </div>
          <p className="text-sm text-muted-foreground">
            Applying AI enhancements...
          </p>
        </motion.div>
      </motion.div>

      {/* Keyboard Shortcuts Helper */}
      <div className="fixed bottom-4 right-4 text-xs text-muted-foreground knoux-signature">
        Space: Play/Pause • Ctrl+S: Save • Ctrl+Z: Undo
      </div>
    </div>
  );
}

// Add keyboard shortcuts
if (typeof window !== "undefined") {
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target === document.body) {
      e.preventDefault();
      // Trigger play/pause
    }
    if (e.ctrlKey || e.metaKey) {
      switch (e.code) {
        case "KeyS":
          e.preventDefault();
          // Trigger save
          break;
        case "KeyZ":
          e.preventDefault();
          if (e.shiftKey) {
            // Trigger redo
          } else {
            // Trigger undo
          }
          break;
      }
    }
  });
}
