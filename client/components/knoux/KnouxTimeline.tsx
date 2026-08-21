import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Scissors,
  Copy,
  Trash2,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  KnouxProjectState,
  KnouxTrack,
  KnouxClipData,
} from "@/lib/knouxDataTypes";

interface KnouxTimelineProps {
  projectState?: Partial<KnouxProjectState>;
  onClipSelect?: (clipId: string) => void;
  onClipMove?: (clipId: string, newTime: number, newTrackId: string) => void;
  onTimelineSeek?: (time: number) => void;
  selectedClipId?: string;
}

export function KnouxTimeline({
  projectState,
  onClipSelect,
  onClipMove,
  onTimelineSeek,
  selectedClipId,
}: KnouxTimelineProps) {
  const [zoom, setZoom] = useState(1);
  const [draggedClip, setDraggedClip] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const currentTime = Math.max(0, projectState?.timeline?.currentTime || 0);
  const duration = Math.max(1, projectState?.timeline?.duration || 100);
  const tracks = projectState?.timeline?.tracks || mockTracks;

  const pixelsPerSecond = Math.max(1, 10 * Math.max(0.1, zoom));
  const timelineWidth = Math.max(800, duration * pixelsPerSecond);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const timeToPixels = (time: number) =>
    Math.max(0, (time || 0) * pixelsPerSecond);
  const pixelsToTime = (pixels: number) =>
    Math.max(0, (pixels || 0) / pixelsPerSecond);

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = pixelsToTime(x);
    onTimelineSeek?.(Math.max(0, Math.min(duration, time)));
  };

  return (
    <motion.div
      className="knoux-glass-panel knoux-timeline flex flex-col h-full border-t border-cyan-500/20"
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
    >
      {/* Timeline Header */}
      <div className="knoux-glass-panel p-3 border-b border-cyan-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h3 className="font-semibold text-cyan-300">Timeline</h3>

            <div className="flex items-center gap-2">
              <Button size="sm" className="knoux-icon-button">
                <Plus className="w-4 h-4" />
              </Button>

              <Button size="sm" className="knoux-icon-button">
                <Scissors className="w-4 h-4" />
              </Button>

              <Button size="sm" className="knoux-icon-button">
                <Copy className="w-4 h-4" />
              </Button>

              <Button size="sm" className="knoux-icon-button">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Zoom:</span>
            <Button
              size="sm"
              onClick={() => setZoom(Math.max(0.1, zoom - 0.2))}
              className="knoux-icon-button px-2"
            >
              -
            </Button>
            <span className="text-sm font-mono w-12 text-center">
              {(zoom * 100).toFixed(0)}%
            </span>
            <Button
              size="sm"
              onClick={() => setZoom(Math.min(3, zoom + 0.2))}
              className="knoux-icon-button px-2"
            >
              +
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Track Headers */}
        <div className="w-48 bg-card border-r border-cyan-500/20">
          <div className="h-8 border-b border-cyan-500/20 flex items-center px-3">
            <span className="text-xs font-medium text-muted-foreground">
              TRACKS
            </span>
          </div>

          <ScrollArea className="h-full knoux-scrollbar">
            {tracks.map((track) => (
              <TrackHeader key={track.id} track={track} />
            ))}
          </ScrollArea>
        </div>

        {/* Timeline Content */}
        <div className="flex-1 relative overflow-hidden">
          {/* Time Ruler */}
          <div className="h-8 border-b border-cyan-500/20 bg-card/50 relative">
            <div
              className="absolute inset-0"
              style={{ width: `${timelineWidth}px` }}
            >
              {Array.from(
                { length: Math.max(1, Math.ceil(duration / 10) + 1) },
                (_, i) => i * 10,
              ).map((time) => (
                <div
                  key={time}
                  className="absolute border-l border-cyan-500/30"
                  style={{ left: `${timeToPixels(time)}px` }}
                >
                  <span className="absolute top-1 left-1 text-xs text-cyan-400 font-mono">
                    {formatTime(time)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline Tracks */}
          <ScrollArea className="h-full knoux-scrollbar">
            <div
              ref={timelineRef}
              className="relative cursor-pointer"
              style={{ width: Math.max(timelineWidth, "100%") }}
              onClick={handleTimelineClick}
            >
              {tracks.map((track, trackIndex) => (
                <TimelineTrack
                  key={track.id}
                  track={track}
                  pixelsPerSecond={pixelsPerSecond}
                  selectedClipId={selectedClipId}
                  onClipSelect={onClipSelect}
                  trackIndex={trackIndex}
                />
              ))}

              {/* Playhead */}
              <motion.div
                className="absolute top-0 bottom-0 w-0.5 knoux-playhead pointer-events-none z-20"
                style={{ left: `${timeToPixels(currentTime)}px` }}
                animate={{ left: `${timeToPixels(currentTime)}px` }}
                transition={{ duration: 0.1 }}
              >
                <div className="w-3 h-3 bg-cyan-400 transform -translate-x-1/2 -translate-y-1/2 absolute top-0 rounded-full shadow-lg" />
              </motion.div>
            </div>
          </ScrollArea>
        </div>
      </div>
    </motion.div>
  );
}

function TrackHeader({ track }: { track: KnouxTrack }) {
  const [isLocked, setIsLocked] = useState(track.locked);
  const [isMuted, setIsMuted] = useState(track.muted);
  const [isVisible, setIsVisible] = useState(true);

  const getTrackIcon = () => {
    switch (track.type) {
      case "video":
        return "🎬";
      case "audio":
        return "🎵";
      case "text":
        return "📝";
      case "effect":
        return "✨";
      case "ai-layer":
        return "🤖";
      default:
        return "📁";
    }
  };

  return (
    <div className="h-16 border-b border-cyan-500/10 p-2 flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm">{getTrackIcon()}</span>
          <span className="text-sm font-medium truncate">{track.name}</span>
        </div>

        {track.type === "ai-layer" && (
          <Badge className="knoux-ai-indicator text-xs px-1 py-0">AI</Badge>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setIsMuted(!isMuted)}
          className="p-1 h-6 w-6"
        >
          {isMuted ? (
            <VolumeX className="w-3 h-3" />
          ) : (
            <Volume2 className="w-3 h-3" />
          )}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => setIsVisible(!isVisible)}
          className="p-1 h-6 w-6"
        >
          {isVisible ? (
            <Eye className="w-3 h-3" />
          ) : (
            <EyeOff className="w-3 h-3" />
          )}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => setIsLocked(!isLocked)}
          className="p-1 h-6 w-6"
        >
          {isLocked ? (
            <Lock className="w-3 h-3" />
          ) : (
            <Unlock className="w-3 h-3" />
          )}
        </Button>
      </div>
    </div>
  );
}

function TimelineTrack({
  track,
  pixelsPerSecond,
  selectedClipId,
  onClipSelect,
  trackIndex,
}: {
  track: KnouxTrack;
  pixelsPerSecond: number;
  selectedClipId?: string;
  onClipSelect?: (clipId: string) => void;
  trackIndex: number;
}) {
  return (
    <div className="h-16 border-b border-cyan-500/10 relative knoux-timeline-track">
      {track.clips.map((clip) => (
        <TimelineClip
          key={clip.id}
          clip={clip}
          pixelsPerSecond={pixelsPerSecond}
          isSelected={clip.id === selectedClipId}
          onSelect={() => onClipSelect?.(clip.id)}
        />
      ))}
    </div>
  );
}

function TimelineClip({
  clip,
  pixelsPerSecond,
  isSelected,
  onSelect,
}: {
  clip: KnouxClipData;
  pixelsPerSecond: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const safePixelsPerSecond = Math.max(1, pixelsPerSecond || 1);
  const left = Math.max(0, (clip.startTime || 0) * safePixelsPerSecond);
  const width = Math.max(20, (clip.duration || 1) * safePixelsPerSecond);

  const getClipColor = () => {
    switch (clip.type) {
      case "video-clip":
        return "from-blue-500/30 to-blue-600/30 border-blue-500/50";
      case "audio-clip":
        return "from-green-500/30 to-green-600/30 border-green-500/50";
      case "image-clip":
        return "from-purple-500/30 to-purple-600/30 border-purple-500/50";
      case "text-clip":
        return "from-yellow-500/30 to-yellow-600/30 border-yellow-500/50";
      case "ai-generated":
        return "from-cyan-500/30 to-cyan-600/30 border-cyan-500/50";
      case "face-fx":
        return "from-pink-500/30 to-pink-600/30 border-pink-500/50";
      case "body-fx":
        return "from-red-500/30 to-red-600/30 border-red-500/50";
      default:
        return "from-gray-500/30 to-gray-600/30 border-gray-500/50";
    }
  };

  return (
    <motion.div
      className={`
        absolute top-1 bottom-1 rounded knoux-clip cursor-pointer
        bg-gradient-to-r ${getClipColor()}
        ${isSelected ? "ring-2 ring-cyan-400 ring-offset-2 ring-offset-background" : ""}
      `}
      style={{ left: `${left}px`, width: `${width}px` }}
      onClick={onSelect}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      drag="x"
      dragMomentum={false}
    >
      <div className="p-1 h-full flex flex-col justify-between text-xs">
        <div className="font-medium truncate text-white">{clip.name}</div>

        {clip.aiSettings && (
          <Badge className="knoux-ai-indicator text-xs px-1 py-0 self-start">
            AI
          </Badge>
        )}
      </div>
    </motion.div>
  );
}

// Mock data for demonstration
const mockTracks: KnouxTrack[] = [
  {
    id: "track-1",
    name: "Video Track 1",
    type: "video",
    clips: [
      {
        id: "clip-1",
        name: "Main Video",
        type: "video-clip",
        startTime: 5,
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
          blendMode: "normal",
        },
      },
      {
        id: "clip-2",
        name: "B-Roll",
        type: "video-clip",
        startTime: 40,
        duration: 15,
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
          blendMode: "normal",
        },
      },
    ],
    muted: false,
    locked: false,
    height: 64,
  },
  {
    id: "track-2",
    name: "Face FX Layer",
    type: "ai-layer",
    clips: [
      {
        id: "clip-3",
        name: "Face Enhancement",
        type: "face-fx",
        startTime: 5,
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
          blendMode: "overlay",
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
        },
      },
    ],
    muted: false,
    locked: false,
    height: 64,
  },
  {
    id: "track-3",
    name: "Audio Track",
    type: "audio",
    clips: [
      {
        id: "clip-4",
        name: "Background Music",
        type: "audio-clip",
        startTime: 0,
        duration: 60,
        properties: {
          transform: {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
          },
          effects: [],
          opacity: 1,
          blendMode: "normal",
        },
      },
    ],
    muted: false,
    locked: false,
    height: 64,
  },
];
