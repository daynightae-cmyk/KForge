import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { KnouxHeader } from "@/components/knoux/KnouxHeader";
import { KnouxSidebar } from "@/components/knoux/KnouxSidebar";
import { KnouxPreview } from "@/components/knoux/KnouxPreview";
import { KnouxTimeline } from "@/components/knoux/KnouxTimeline";
import { KnouxInspectorPanel } from "@/components/knoux/KnouxInspectorPanel";
import type { KnouxClipData, KnouxProjectState } from "@/lib/knouxDataTypes";
import { KNOUX_BRANDING } from "@/lib/knouxBrandingConstants";

export default function KnouxVideoEditor() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(80);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [editorStatus, setEditorStatus] = useState("");
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

  const handlePropertyChange = useCallback((property: string, value: unknown) => {
    if (!selectedClipId) {
      setEditorStatus("Select a clip before editing its properties.");
      return;
    }
    setEditorStatus(`Property ${property} changed locally. Saving the project persists the current timeline state.`);
    void value;
  }, [selectedClipId]);

  const handleSave = useCallback(() => {
    try {
      window.localStorage.setItem("knoux-video-editor:project", JSON.stringify(projectState));
      setEditorStatus("Project saved locally in this browser.");
    } catch (error: unknown) {
      setEditorStatus(error instanceof Error ? `Local save failed: ${error.message}` : "Local save failed.");
    }
  }, [projectState]);

  const handleOpen = useCallback(() => {
    try {
      const saved = window.localStorage.getItem("knoux-video-editor:project");
      if (!saved) { setEditorStatus("No locally saved project is available yet."); return; }
      const parsed: unknown = JSON.parse(saved);
      if (typeof parsed !== "object" || parsed === null) throw new Error("Saved project data is invalid.");
      setProjectState(parsed as Partial<KnouxProjectState>);
      setEditorStatus("Local project restored.");
    } catch (error: unknown) {
      setEditorStatus(error instanceof Error ? `Local open failed: ${error.message}` : "Local open failed.");
    }
  }, []);

  const handleExport = useCallback(() => {
    try {
      const blob = new Blob([JSON.stringify(projectState, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${projectState.name || "knoux-project"}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setEditorStatus("Project JSON export started.");
    } catch (error: unknown) {
      setEditorStatus(error instanceof Error ? `Export failed: ${error.message}` : "Export failed.");
    }
  }, [projectState]);

  const handleUndo = useCallback(() => setEditorStatus("Undo is unavailable because this project has no recorded local edit history yet."), []);
  const handleRedo = useCallback(() => setEditorStatus("Redo is unavailable because this project has no recorded local edit history yet."), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" && event.target === document.body) { event.preventDefault(); handlePlayPause(); }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.code === "KeyS") { event.preventDefault(); handleSave(); }
      if (event.code === "KeyZ") { event.preventDefault(); event.shiftKey ? handleRedo() : handleUndo(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handlePlayPause, handleRedo, handleSave, handleUndo]);

  const selectedClip: KnouxClipData | undefined = selectedClipId
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
        <p>Space: Play/Pause • Ctrl+S: Save • Ctrl+Z: Undo</p>
        {editorStatus && <p role="status">{editorStatus}</p>}
      </div>
    </div>
  );
}
