import { motion } from "framer-motion";
import {
  FileVideo,
  Save,
  FolderOpen,
  Settings,
  Download,
  Undo,
  Redo,
  Play,
  Pause,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { KnouxLogoAnimated } from "./KnouxLogoAnimated";
import { KNOUX_BRANDING } from "@/lib/knouxBrandingConstants";

interface KnouxHeaderProps {
  isPlaying?: boolean;
  onPlayPause?: () => void;
  onSave?: () => void;
  onOpen?: () => void;
  onExport?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  projectName?: string;
}

export function KnouxHeader({
  isPlaying = false,
  onPlayPause,
  onSave,
  onOpen,
  onExport,
  onUndo,
  onRedo,
  projectName = "Untitled Project",
}: KnouxHeaderProps) {
  return (
    <motion.header
      className="knoux-glass-header p-3 flex items-center justify-between"
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <div className="flex items-center gap-4">
        <KnouxLogoAnimated size="md" />

        <div className="flex flex-col">
          <h1 className="text-lg font-bold knoux-gradient-text">
            {KNOUX_BRANDING.APP_NAME}
          </h1>
          <span className="text-xs text-cyan-400">
            {KNOUX_BRANDING.APP_SUBTITLE}
          </span>
        </div>

        <div className="h-8 w-px bg-cyan-500/30 mx-2" />

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpen}
            className="knoux-icon-button"
          >
            <FolderOpen className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onSave}
            className="knoux-icon-button"
          >
            <Save className="w-4 h-4" />
          </Button>

          <div className="h-4 w-px bg-cyan-500/30 mx-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={onUndo}
            className="knoux-icon-button"
          >
            <Undo className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onRedo}
            className="knoux-icon-button"
          >
            <Redo className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-cyan-300">{projectName}</span>

        <div className="h-8 w-px bg-cyan-500/30 mx-2" />

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onPlayPause}
            className="knoux-neon-button"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </Button>

          <Button variant="ghost" size="sm" className="knoux-icon-button">
            <Volume2 className="w-4 h-4" />
          </Button>
        </div>

        <div className="h-8 w-px bg-cyan-500/30 mx-2" />

        <Button
          variant="ghost"
          size="sm"
          onClick={onExport}
          className="knoux-secondary-button"
        >
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>

        <Button variant="ghost" size="sm" className="knoux-icon-button">
          <Settings className="w-4 h-4" />
        </Button>
      </div>

      <motion.div
        className="absolute bottom-0 right-4 knoux-signature"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1, duration: 1 }}
      >
        {KNOUX_BRANDING.SIGNATURE_PRIMARY}
      </motion.div>
    </motion.header>
  );
}
