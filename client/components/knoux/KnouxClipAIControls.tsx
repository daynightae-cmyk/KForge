if(condition) {
  // src/components/knoux/KnouxClipAIControls.tsx
  /**
   * Knoux Edita PRO - Clip AI Controls Panel (KnouxClipAIControls)
   *
   * This component is displayed in the Inspector Panel when a ClipData is selected.
   * It provides user interface controls and actions specific to AI capabilities
   * applicable to the selected clip (based on its type and detected content).
   *
   * It features:
   * - Rendering dynamic controls for AI model parameters (e.g., Face FX sliders).
   * - Providing interfaces for AI-triggered actions (e.g., Object Isolation mode).
   * - A Natural Language Prompt input area to issue direct commands to Knoux AI regarding the clip.
   * - Displaying feedback or suggestions from AI analysis.
   *
   * This component directly exposes the power and precision of the Knoux AI Core Engine
   * for detailed clip manipulation. It utilizes custom Knoux UI components (Sliders, Buttons, Inputs).
   */
  
  import React, { useState, useEffect, useCallback } from "react";
  import { motion } from "framer-motion";
  import {
    Bot,
    Sparkles,
    Wand2,
    Eye,
    Loader2,
    ChevronRight,
    AlertCircle,
    Play,
    Zap,
    Target,
  } from "lucide-react";
  import { Button } from "@/components/ui/button";
  import { Slider } from "@/components/ui/slider";
  import { Textarea } from "@/components/ui/textarea";
  import { Badge } from "@/components/ui/badge";
  import { ScrollArea } from "@/components/ui/scroll-area";
  import { Separator } from "@/components/ui/separator";
  
  // Import shared data types, including the detailed AI properties structure.
  import type { KnouxClipData } from "@/lib/knouxDataTypes";
  
  // Props definition for the AI Controls component.
  interface KnouxClipAIControlsProps {
    clip: KnouxClipData; // The selected clip data (read-only prop, reflects Engine state)
  }
  
  // Mock AI Effect Definitions
  interface AIParameterDef {
    id: string;
    name: string;
    type: "number" | "boolean" | "select";
    defaultValue: any;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
  }
  
  interface AIEffectDefinition {
    id: string;
    name: string;
    parameters: AIParameterDef[];
  }
  
  // Implementation of the AI Controls section component.
  export function KnouxClipAIControls({ clip }: KnouxClipAIControlsProps) {
    // State for the natural language AI prompt input area value.
    const [aiPromptText, setAiPromptText] = useState("");
    // State to manage the loading indicator when a prompt is being processed.
    const [isSendingPrompt, setIsSendingPrompt] = useState(false);
    // State to hold and display suggestions/responses received from Knoux AI for the prompt.
    const [aiPromptSuggestions, setAiPromptSuggestions] = useState<any | null>(
      null,
    );
  
    // Mock AI effects available for this clip type
    const [availableAIEffects] = useState<AIEffectDefinition[]>([
      {
        id: "ai-face-sculptpro",
        name: "Face SculptPro™",
        parameters: [
          {
            id: "skinSmoothing",
            name: "نعومة البشرة",
            type: "number",
            defaultValue: 0.7,
            min: 0,
            max: 1,
            step: 0.1,
            unit: "%",
          },
          {
            id: "eyeEnhancement",
            name: "تكبير العيون",
            type: "number",
            defaultValue: 1.2,
            min: 0.5,
            max: 2,
            step: 0.1,
            unit: "x",
          },
          {
            id: "jawlineRefinement",
            name: "تحديد الفك",
            type: "number",
            defaultValue: 0.8,
            min: 0,
            max: 1,
            step: 0.1,
            unit: "%",
          },
          {
            id: "teethWhitening",
            name: "تبييض الأسنان",
            type: "number",
            defaultValue: 0.6,
            min: 0,
            max: 1,
            step: 0.1,
            unit: "%",
          },
        ],
      },
      {
        id: "ai-object-isolation",
        name: "Fine Edge™ Object Isolation",
        parameters: [
          {
            id: "edgeRefinement",
            name: "دقة الحواف",
            type: "number",
            defaultValue: 0.85,
            min: 0,
            max: 1,
            step: 0.05,
            unit: "%",
          },
          {
            id: "trackingAccuracy",
            name: "دقة التتبع",
            type: "number",
            defaultValue: 0.9,
            min: 0.5,
            max: 1,
            step: 0.05,
            unit: "%",
          },
          {
            id: "motionBlurCompensation",
            name: "تعويض ضبابية الحركة",
            type: "number",
            defaultValue: 0.7,
            min: 0,
            max: 1,
            step: 0.1,
            unit: "%",
          },
        ],
      },
    ]);
  
    // Mock current AI settings for the clip
    const [currentAISettings, setCurrentAISettings] = useState({
      faceFxParameters: {
        skinSmoothing: 0.7,
        eyeEnhancement: 1.2,
        jawlineRefinement: 0.8,
        teethWhitening: 0.6,
      },
      objectMaskParameters: {
        edgeRefinement: 0.85,
        trackingAccuracy: 0.9,
        motionBlurCompensation: 0.7,
      },
    });
  
    // Handler for the "Send AI Prompt" button click.
    const handleSendAIPrompt = useCallback(async () => {
      if (!aiPromptText.trim() || isSendingPrompt) return;
  
      setIsSendingPrompt(true);
      setAiPromptSuggestions(null);
  
      console.log(
        `Knoux UI Command (AI Controls): Sending AI Prompt "${aiPromptText}" for clip ${clip.id}.`,
      );
  
      // Simulate AI processing
      try {
        await new Promise((resolve) => setTimeout(resolve, 2000));
  
        // Mock AI response based on prompt content
        const response = generateMockAIResponse(aiPromptText);
        setAiPromptSuggestions(response);
        setIsSendingPrompt(false);
      } catch (error) {
        console.error("Knoux UI Command Error sending AI Prompt:", error);
        setIsSendingPrompt(false);
        setAiPromptSuggestions({
          error: `فشل إرسال الأمر لـ Knoux AI: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }, [aiPromptText, clip.id, isSendingPrompt]);
  
    // Mock AI response generator
    const generateMockAIResponse = (prompt: string) => {
      const lowerPrompt = prompt.toLowerCase();
  
      if (lowerPrompt.includes("face") || lowerPrompt.includes("وجه")) {
        return {
          text: "تم تحليل الوجه في الفيديو. اكتشفت خوارزميات Knoux AI وجه واحد رئيسي.",
          suggestions: [
            {
              text: "تطبيق تحسين الوجه التلقائي",
              action: { type: "applyEffect", effectId: "ai-face-sculptpro" },
            },
            {
              text: "تفعيل تتبع الوجه المتقدم",
              action: { type: "enableFaceTracking" },
            },
          ],
        };
      }
  
      if (lowerPrompt.includes("enhance") || lowerPrompt.includes("تحسين")) {
        return {
          text: "Knoux AI يقترح عدة طرق لتحسين جودة هذا المقطع.",
          suggestions: [
            {
              text: "تحسين جودة الصورة بالذكاء الاصطناعي",
              action: { type: "enhanceQuality" },
            },
            {
              text: "تقليل الضوضاء التلقائي",
              action: { type: "reduceNoise" },
            },
          ],
        };
      }
  
      return {
        text: "تم استقبال طلبك بنجاح. Knoux AI يعمل على تحليل المحتوى وإنشاء اقتراحات مخصصة.",
        suggestions: [
          {
            text: "تطبيق تحسينات عامة",
            action: { type: "generalEnhancement" },
          },
        ],
      };
    };
  
    // Handler for applying AI suggestions
    const handleApplySuggestion = useCallback(
      (suggestion: any) => {
        console.log(
          "Knoux UI Action (AI Controls): Applying AI suggestion:",
          suggestion,
        );
  
        // Mock implementation - in real app this would call engine interfaces
        if (suggestion.action?.type === "applyEffect") {
          alert(`تم تطبيق التأثير: ${suggestion.text}`);
        } else {
          alert(`تم تنفيذ الإجراء: ${suggestion.text}`);
        }
      },
      [clip.id],
    );
  
    // Parameter update handler
    const handleParameterChange = useCallback(
      (category: string, paramId: string, value: number) => {
        setCurrentAISettings((prev) => ({
          ...prev,
          [category]: {
            ...prev[category as keyof typeof prev],
            [paramId]: value,
          },
        }));
  
        console.log(
          `Updated ${category}.${paramId} to ${value} for clip ${clip.id}`,
        );
      },
      [clip.id],
    );
  
    // Render AI Parameter Controls
    const renderAIParameterControls = () => {
      const controls: React.ReactNode[] = [];
  
      // Face FX Controls
      if (clip.aiSettings?.faceFX?.enabled) {
        const faceFxEffect = availableAIEffects.find(
          (e) => e.id === "ai-face-sculptpro",
        );
  
        controls.push(
          <motion.div
            key="ai-face-fx-group"
            className="space-y-4 p-4 rounded-lg bg-pink-500/5 border border-pink-500/20"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-pink-400" />
              <h5 className="font-semibold text-white">
                Face SculptPro™
                <Badge className="ml-2 bg-pink-500/20 text-pink-300 border-pink-500/30">
                  AI نشط
                </Badge>
              </h5>
            </div>
            <p className="text-xs text-gray-400">
              ضبط دقيق لميزات الوجه باستخدام خوارزميات Knoux AI المتقدمة.
            </p>
  
            <div className="space-y-4">
              {faceFxEffect?.parameters.map((param) => (
                <div key={param.id} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-gray-300">
                      {param.name}
                    </label>
                    <span className="text-xs text-cyan-400 font-mono">
                      {(
                        currentAISettings.faceFxParameters[
                          param.id as keyof typeof currentAISettings.faceFxParameters
                        ] * 100
                      ).toFixed(0)}
                      {param.unit}
                    </span>
                  </div>
                  <Slider
                    value={[
                      currentAISettings.faceFxParameters[
                        param.id as keyof typeof currentAISettings.faceFxParameters
                      ],
                    ]}
                    onValueChange={([value]) =>
                      handleParameterChange("faceFxParameters", param.id, value)
                    }
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    className="w-full"
                  />
                </div>
              ))}
            </div>
          </motion.div>,
        );
      }
  
      // Object Isolation Controls
      if (clip.aiSettings?.bodyTracking?.enabled) {
        const objectEffect = availableAIEffects.find(
          (e) => e.id === "ai-object-isolation",
        );
  
        controls.push(
          <motion.div
            key="ai-object-mask-group"
            className="space-y-4 p-4 rounded-lg bg-cyan-500/5 border border-cyan-500/20"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-cyan-400" />
              <h5 className="font-semibold text-white">
                عزل وتتبع العناصر
                <Badge className="ml-2 bg-cyan-500/20 text-cyan-300 border-cyan-500/30">
                  Fine Edge™
                </Badge>
              </h5>
            </div>
            <p className="text-xs text-gray-400">
              حدد كائناً في المعاينة. سيقوم AI بإنشاء قناع دقيق وتتبع حركته
              تلقائياً.
            </p>
  
            <Button
              className="w-full bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30"
              onClick={() => {
                console.log("Activating AI Object Selection Tool");
                alert(
                  "ℹ️ الآن انقر على الكائن الذي تريد عزله في نافذة المعاينة.",
                );
              }}
            >
              <Target className="w-4 h-4 mr-2" />
              بدء تحديد عنصر جديد
            </Button>
  
            <div className="space-y-4">
              {objectEffect?.parameters.map((param) => (
                <div key={param.id} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-gray-300">
                      {param.name}
                    </label>
                    <span className="text-xs text-cyan-400 font-mono">
                      {(
                        currentAISettings.objectMaskParameters[
                          param.id as keyof typeof currentAISettings.objectMaskParameters
                        ] * 100
                      ).toFixed(0)}
                      {param.unit}
                    </span>
                  </div>
                  <Slider
                    value={[
                      currentAISettings.objectMaskParameters[
                        param.id as keyof typeof currentAISettings.objectMaskParameters
                      ],
                    ]}
                    onValueChange={([value]) =>
                      handleParameterChange(
                        "objectMaskParameters",
                        param.id,
                        value,
                      )
                    }
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    className="w-full"
                  />
                </div>
              ))}
            </div>
          </motion.div>,
        );
      }
  
      // No AI controls fallback
      if (controls.length === 0) {
        controls.push(
          <motion.div
            key="ai-no-controls-fallback"
            className="text-center py-8 space-y-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <Bot className="w-12 h-12 mx-auto text-gray-500" />
            <div className="space-y-2">
              <p className="text-gray-400">
                لا توجد إعدادات AI متخصصة لهذا النوع من المقاطع حالياً.
              </p>
              <p className="text-sm text-gray-500">
                يمكنك محاولة إعطاء تعليمات لـ Knoux AI أدناه!
              </p>
            </div>
          </motion.div>,
        );
      }
  
      return controls;
    };
  
    return (
      <ScrollArea className="h-full">
        <div className="space-y-6 p-4">
          {/* Dynamic AI Parameter Controls */}
          {renderAIParameterControls()}
  
          <Separator className="bg-gray-700/50" />
  
          {/* General AI Prompt Section */}
          <motion.div
            className="space-y-4 p-4 rounded-lg bg-blue-500/5 border border-blue-500/20"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
          >
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-cyan-400 drop-shadow-[0_0_4px_rgba(0,255,255,0.6)]" />
              <h5 className="font-semibold text-white">
                محادثة مباشرة مع <span className="text-cyan-400">Knoux AI</span>
              </h5>
            </div>
  
            <p className="text-xs text-gray-400 leading-relaxed">
              استخدم اللغة الطبيعية (عربي أو إنجليزي) لإخبار Knoux AI بما تريد
              تحقيقه لهذا المقطع.
              <br />
              Knoux AI سيقوم بتحليل طلبك واقتراح أو تطبيق تعديلات ذكية.
            </p>
  
            <Textarea
              value={aiPromptText}
              onChange={(e) => setAiPromptText(e.target.value)}
              placeholder={`مثال: "طبّق نمط سينمائي داكن على هذا الفيديو", "حسّن جودة الصورة باستخدام AI", "اقتراح مؤثرات صوتية لهذا الجزء"...`}
              rows={4}
              disabled={isSendingPrompt}
              className="bg-black/20 border-gray-600 text-white placeholder:text-gray-500 resize-none"
            />
  
            <Button
              onClick={handleSendAIPrompt}
              disabled={!aiPromptText.trim() || isSendingPrompt}
              className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
            >
              {isSendingPrompt ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  جاري معالجة الأمر...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  أرسل الأمر لـ Knoux AI
                </>
              )}
            </Button>
  
            {/* AI Response Display */}
            {aiPromptSuggestions && (
              <motion.div
                className="space-y-3"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {aiPromptSuggestions.error && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 inline mr-2" />
                    {aiPromptSuggestions.error}
                  </div>
                )}
  
                {aiPromptSuggestions.text && !aiPromptSuggestions.error && (
                  <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-sm">
                    <Bot className="w-4 h-4 inline mr-2" />
                    {aiPromptSuggestions.text}
                  </div>
                )}
  
                {aiPromptSuggestions.suggestions &&
                  Array.isArray(aiPromptSuggestions.suggestions) && (
                    <div className="space-y-2">
                      <h6 className="text-sm text-gray-300 flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        اقتراحات Knoux AI:
                      </h6>
                      {aiPromptSuggestions.suggestions.map(
                        (suggestion: any, index: number) => (
                          <div
                            key={`ai-sug-${index}`}
                            className="p-3 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-between"
                          >
                            <span className="text-gray-300 text-sm">
                              {suggestion.text}
                            </span>
                            {suggestion.action && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleApplySuggestion(suggestion)}
                                className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                              >
                                تطبيق
                                <ChevronRight className="w-4 h-4 ml-1" />
                              </Button>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  )}
              </motion.div>
            )}
          </motion.div>
        </div>
      </ScrollArea>
    );
  }
  
  export default KnouxClipAIControls;
}
