import { motion } from "framer-motion";
import { Zap } from "lucide-react";

interface KnouxLogoAnimatedProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export function KnouxLogoAnimated({
  size = "md",
  showText = true,
}: KnouxLogoAnimatedProps) {
  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-12 h-12",
  };

  const textSizeClasses = {
    sm: "text-sm",
    md: "text-lg",
    lg: "text-2xl",
  };

  return (
    <div className="flex items-center gap-2">
      <motion.div
        className={`${sizeClasses[size]} knoux-logo-glow`}
        animate={{
          rotateY: [0, 360],
          scale: [1, 1.1, 1],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <div className="relative">
          <Zap className="w-full h-full text-cyan-400" fill="currentColor" />
          <motion.div
            className="absolute inset-0"
            animate={{
              opacity: [0.5, 1, 0.5],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <Zap
              className="w-full h-full text-purple-400"
              fill="currentColor"
            />
          </motion.div>
        </div>
      </motion.div>

      {showText && (
        <motion.div
          className={`font-bold knoux-gradient-text ${textSizeClasses[size]}`}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5, duration: 0.8 }}
        >
          Knoux
        </motion.div>
      )}
    </div>
  );
}
