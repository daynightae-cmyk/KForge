import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { KnouxLogoAnimated } from "@/components/knoux/KnouxLogoAnimated";
import { KNOUX_BRANDING } from "@/lib/knouxBrandingConstants";
import { Video, Sparkles, Bot, Zap, Star, ArrowRight } from "lucide-react";

export default function Index() {
  const navigate = useNavigate();

  const features = [
    {
      icon: Bot,
      title: "Face FX AI Filters",
      description: "فلاتر ذكاء صناعي احترافية لتجميل الوجه والعيون",
      color: "text-cyan-400",
    },
    {
      icon: Sparkles,
      title: "Smart Preview",
      description: "شاشة معاينة فيديو حية بتقنيات WebGL",
      color: "text-pink-400",
    },
    {
      icon: Video,
      title: "AI Voice Enhancer",
      description: "مؤثر صوتي تلقائي يحسّن الصوت حسب الجنس",
      color: "text-purple-400",
    },
    {
      icon: Star,
      title: "Anime & Fantasy FX",
      description: "مؤثرات وجوه أنمي وشخصيات خيالية",
      color: "text-yellow-400",
    },
  ];

  return (
    <div className="min-h-screen bg-background overflow-hidden relative">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-purple-500/10 to-pink-500/10" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,255,255,0.1),transparent_50%)]" />

      {/* Hero Section */}
      <div className="relative z-10 container mx-auto px-4 py-20">
        <motion.div
          className="text-center max-w-4xl mx-auto"
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          {/* Logo and Title */}
          <div className="flex items-center justify-center mb-8">
            <KnouxLogoAnimated size="lg" />
          </div>

          <motion.h1
            className="text-6xl md:text-8xl font-bold mb-6"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.8 }}
          >
            <span className="knoux-gradient-text">
              {KNOUX_BRANDING.APP_NAME}
            </span>
          </motion.h1>

          <motion.p
            className="text-2xl md:text-3xl text-cyan-300 mb-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.8 }}
          >
            {KNOUX_BRANDING.APP_SUBTITLE}
          </motion.p>

          <motion.p
            className="text-lg text-muted-foreground mb-12 max-w-2xl mx-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9, duration: 0.8 }}
          >
            محرر فيديو احترافي مدعوم بالذكاء الاصطناعي مع مؤثرات تجميل الوجه
            وتحرير الجسم والمكياج الذكي
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            className="flex flex-col sm:flex-row gap-4 justify-center mb-16"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2, duration: 0.8 }}
          >
            <Button
              size="lg"
              onClick={() => navigate("/editor")}
              className="knoux-neon-button text-lg px-8 py-4 h-auto"
            >
              <Zap className="w-5 h-5 mr-3" />
              Launch Editor
              <ArrowRight className="w-5 h-5 ml-3" />
            </Button>

            <Button
              size="lg"
              variant="outline"
              className="knoux-secondary-button text-lg px-8 py-4 h-auto"
            >
              <Video className="w-5 h-5 mr-3" />
              Watch Demo
            </Button>
          </motion.div>

          {/* Features Grid */}
          <motion.div
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.5, duration: 0.8 }}
          >
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                className="knoux-glass-panel p-6 text-center hover:border-cyan-400/50 transition-colors"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.7 + index * 0.1, duration: 0.6 }}
                whileHover={{ scale: 1.05 }}
              >
                <feature.icon
                  className={`w-12 h-12 mx-auto mb-4 ${feature.color}`}
                />
                <h3 className="text-lg font-semibold mb-2 text-white">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </motion.div>

          {/* AI Models Showcase */}
          <motion.div
            className="knoux-glass-panel p-8 text-center"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 2, duration: 0.8 }}
          >
            <div className="knoux-ai-indicator mb-4 mx-auto w-fit">
              <Bot className="w-5 h-5" />
              Powered by Advanced AI Models
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
              {Object.values(KNOUX_BRANDING.AI_MODELS).map((model, index) => (
                <motion.div
                  key={model}
                  className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 2.2 + index * 0.1, duration: 0.5 }}
                >
                  {model}
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Signature */}
          <motion.div
            className="mt-12 knoux-signature text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 3, duration: 1 }}
          >
            {KNOUX_BRANDING.SIGNATURE_PRIMARY}
          </motion.div>
        </motion.div>
      </div>

      {/* Floating Animation Elements */}
      <motion.div
        className="absolute top-20 left-10 w-4 h-4 bg-cyan-400/30 rounded-full"
        animate={{
          y: [0, -20, 0],
          opacity: [0.3, 0.8, 0.3],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      <motion.div
        className="absolute top-40 right-20 w-6 h-6 bg-pink-400/30 rounded-full"
        animate={{
          y: [0, -30, 0],
          x: [0, 10, 0],
          opacity: [0.3, 0.8, 0.3],
        }}
        transition={{
          duration: 6,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1,
        }}
      />

      <motion.div
        className="absolute bottom-40 left-20 w-8 h-8 bg-purple-400/20 rounded-full"
        animate={{
          y: [0, -25, 0],
          opacity: [0.2, 0.6, 0.2],
        }}
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 2,
        }}
      />
    </div>
  );
}
