import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  RotateCcw,
  Maximize2,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { KNOUX_BRANDING } from "@/lib/knouxBrandingConstants";

interface KnouxPreviewProps {
  currentTime?: number;
  duration?: number;
  isPlaying?: boolean;
  onPlayPause?: () => void;
  onSeek?: (time: number) => void;
  onVolumeChange?: (volume: number) => void;
  volume?: number;
}

export function KnouxPreview({
  currentTime = 0,
  duration = 100,
  isPlaying = false,
  onPlayPause,
  onSeek,
  onVolumeChange,
  volume = 80,
}: KnouxPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showOverlays, setShowOverlays] = useState(true);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Simulate video preview with gradient
    const gradient = ctx.createLinearGradient(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    gradient.addColorStop(0, "rgba(0, 255, 255, 0.3)");
    gradient.addColorStop(0.5, "rgba(128, 0, 255, 0.2)");
    gradient.addColorStop(1, "rgba(255, 105, 180, 0.3)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add some animation based on time
    const frame = Math.floor(currentTime * 10) % 100;
    ctx.fillStyle = `rgba(0, 255, 255, ${0.1 + (frame / 100) * 0.2})`;
    ctx.fillRect(frame * 2, frame, 100, 100);
  }, [currentTime]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <motion.div
      className="knoux-glass-panel knoux-preview-area flex-1 flex flex-col"
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      {/* Preview Area */}
      <div className="flex-1 relative overflow-hidden rounded-lg border border-cyan-500/20">
        <canvas
          ref={canvasRef}
          width={1920}
          height={1080}
          className="w-full h-full object-contain bg-black/50"
        />

        {/* AI Overlays */}
        <AnimatePresence>
          {showOverlays && (
            <motion.div
              className="absolute inset-0 pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Face Detection Overlay */}
              <motion.div
                className="absolute border-2 border-cyan-400 rounded-lg"
                style={{
                  left: "30%",
                  top: "25%",
                  width: "200px",
                  height: "240px",
                }}
                animate={{
                  boxShadow: [
                    "0 0 10px rgba(0, 255, 255, 0.5)",
                    "0 0 20px rgba(0, 255, 255, 0.8)",
                    "0 0 10px rgba(0, 255, 255, 0.5)",
                  ],
                }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Badge className="absolute -top-6 left-0 bg-cyan-500/20 text-cyan-300 border-cyan-500/30">
                  Face Detected
                </Badge>
              </motion.div>

              {/* Body Detection Overlay */}
              <motion.div
                className="absolute border-2 border-pink-400 rounded-lg"
                style={{
                  left: "25%",
                  top: "20%",
                  width: "250px",
                  height: "400px",
                }}
                animate={{
                  borderColor: ["#ff69b4", "#8000ff", "#ff69b4"],
                }}
                transition={{ duration: 3, repeat: Infinity }}
              >
                <Badge className="absolute -top-6 right-0 bg-pink-500/20 text-pink-300 border-pink-500/30">
                  Body Tracking
                </Badge>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Overlay Controls */}
        <div className="absolute top-4 right-4 flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowOverlays(!showOverlays)}
            className="knoux-icon-button"
          >
            {showOverlays ? (
              <Eye className="w-4 h-4" />
            ) : (
              <EyeOff className="w-4 h-4" />
            )}
          </Button>

          <Button variant="ghost" size="sm" className="knoux-icon-button">
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>

        {/* Center Play Button */}
        {!isPlaying && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3 }}
          >
            <Button
              onClick={onPlayPause}
              className="knoux-neon-button w-16 h-16 rounded-full"
            >
              <Play className="w-8 h-8" fill="currentColor" />
            </Button>
          </motion.div>
        )}
      </div>

      {/* Controls Bar */}
      <motion.div
        className="knoux-glass-panel p-4 mt-4"
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
      >
        <div className="flex items-center gap-4">
          {/* Play/Pause */}
          <Button onClick={onPlayPause} className="knoux-icon-button">
            {isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </Button>

          {/* Time Display */}
          <div className="text-sm font-mono text-cyan-300">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>

          {/* Timeline Scrubber */}
          <div className="flex-1">
            <Slider
              value={[currentTime]}
              max={duration}
              step={0.1}
              onValueChange={([value]) => onSeek?.(value)}
              className="w-full"
            />
          </div>

          {/* Volume */}
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setIsMuted(!isMuted)}
              className="knoux-icon-button"
            >
              {isMuted ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </Button>

            <div className="w-20">
              <Slider
                value={[isMuted ? 0 : volume]}
                max={100}
                step={1}
                onValueChange={([value]) => onVolumeChange?.(value)}
                className="w-full"
              />
            </div>
          </div>

          {/* Reset */}
          <Button onClick={() => onSeek?.(0)} className="knoux-icon-button">
            <RotateCcw className="w-4 h-4" />
          </Button>
        </div>

        {/* Resolution & Stats */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-cyan-500/20">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>1920x1080 • 60fps</span>
            <span>GPU: Active</span>
            <span>AI: Processing</span>
          </div>

          <div className="knoux-signature text-xs">
            {KNOUX_BRANDING.SIGNATURE_SECONDARY}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
