import { useState } from "react";
import { motion } from "framer-motion";
import {
  Settings,
  Move,
  Sparkles,
  Bot,
  Sliders,
  Palette,
  Eye,
  RotateCw,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KnouxClipData, KnouxAISettings } from "@/lib/knouxDataTypes";
import { KnouxClipAIControls } from "./KnouxClipAIControls";

interface KnouxInspectorPanelProps {
  selectedClip?: KnouxClipData;
  onPropertyChange?: (property: string, value: any) => void;
}

export function KnouxInspectorPanel({
  selectedClip,
  onPropertyChange,
}: KnouxInspectorPanelProps) {
  const [activeTab, setActiveTab] = useState("transform");

  const tabs = [
    { id: "transform", label: "Transform", icon: Move },
    { id: "effects", label: "Effects", icon: Sparkles },
    { id: "ai-controls", label: "AI Controls", icon: Bot },
    { id: "color", label: "Color", icon: Palette },
  ];

  if (!selectedClip) {
    return (
      <motion.div
        className="row-span-2 knoux-glass-panel w-full h-full flex items-center justify-center"
        initial={{ x: 320, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      >
        <div className="text-center text-muted-foreground">
          <Settings className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Select a clip to view properties</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="row-span-2 knoux-glass-panel w-full h-full flex flex-col"
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
    >
      <div className="p-4 border-b border-cyan-500/20">
        <h3 className="font-semibold text-cyan-300 mb-2">Inspector</h3>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-cyan-500/20 text-cyan-300">
            {selectedClip.type}
          </Badge>
          <span className="text-sm font-medium truncate">
            {selectedClip.name}
          </span>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col"
      >
        <TabsList className="grid w-full grid-cols-4 bg-transparent border-b border-cyan-500/20">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="flex flex-col items-center gap-1 py-3 data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400"
            >
              <tab.icon className="w-3 h-3" />
              <span className="text-xs">{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="transform" className="h-full mt-0">
            <TransformPanel
              clip={selectedClip}
              onPropertyChange={onPropertyChange}
            />
          </TabsContent>

          <TabsContent value="effects" className="h-full mt-0">
            <EffectsPanel
              clip={selectedClip}
              onPropertyChange={onPropertyChange}
            />
          </TabsContent>

          <TabsContent value="ai-controls" className="h-full mt-0">
            <KnouxClipAIControls clip={selectedClip} />
          </TabsContent>

          <TabsContent value="color" className="h-full mt-0">
            <ColorPanel
              clip={selectedClip}
              onPropertyChange={onPropertyChange}
            />
          </TabsContent>
        </div>
      </Tabs>
    </motion.div>
  );
}

function TransformPanel({
  clip,
  onPropertyChange,
}: {
  clip: KnouxClipData;
  onPropertyChange?: (property: string, value: any) => void;
}) {
  const transform = clip.properties.transform;

  return (
    <ScrollArea className="h-full knoux-scrollbar">
      <div className="p-4 space-y-6">
        {/* Position */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold text-cyan-300">
            Position
          </Label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">X</Label>
              <Input
                type="number"
                value={transform.x}
                onChange={(e) =>
                  onPropertyChange?.("transform.x", Number(e.target.value))
                }
                className="bg-background/50 border-cyan-500/30"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Y</Label>
              <Input
                type="number"
                value={transform.y}
                onChange={(e) =>
                  onPropertyChange?.("transform.y", Number(e.target.value))
                }
                className="bg-background/50 border-cyan-500/30"
              />
            </div>
          </div>
        </div>

        {/* Scale */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold text-cyan-300">Scale</Label>

          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">
              X: {(transform.scaleX * 100).toFixed(0)}%
            </Label>
            <Slider
              value={[transform.scaleX * 100]}
              onValueChange={([value]) =>
                onPropertyChange?.("transform.scaleX", value / 100)
              }
              max={300}
              min={10}
              step={5}
              className="w-full"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">
              Y: {(transform.scaleY * 100).toFixed(0)}%
            </Label>
            <Slider
              value={[transform.scaleY * 100]}
              onValueChange={([value]) =>
                onPropertyChange?.("transform.scaleY", value / 100)
              }
              max={300}
              min={10}
              step={5}
              className="w-full"
            />
          </div>
        </div>

        {/* Rotation */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold text-cyan-300">
            Rotation
          </Label>

          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">
              {transform.rotation.toFixed(0)}°
            </Label>
            <Slider
              value={[transform.rotation]}
              onValueChange={([value]) =>
                onPropertyChange?.("transform.rotation", value)
              }
              max={360}
              min={-360}
              step={1}
              className="w-full"
            />
          </div>

          <Button
            size="sm"
            onClick={() => onPropertyChange?.("transform.rotation", 0)}
            className="knoux-icon-button w-full"
          >
            <RotateCw className="w-4 h-4 mr-2" />
            Reset Rotation
          </Button>
        </div>

        {/* Opacity */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold text-cyan-300">Opacity</Label>

          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">
              {(clip.properties.opacity * 100).toFixed(0)}%
            </Label>
            <Slider
              value={[clip.properties.opacity * 100]}
              onValueChange={([value]) =>
                onPropertyChange?.("opacity", value / 100)
              }
              max={100}
              min={0}
              step={1}
              className="w-full"
            />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

function EffectsPanel({
  clip,
  onPropertyChange,
}: {
  clip: KnouxClipData;
  onPropertyChange?: (property: string, value: any) => void;
}) {
  const effects = clip.properties.effects || [];

  return (
    <ScrollArea className="h-full knoux-scrollbar">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold text-cyan-300">Effects</Label>
          <Button size="sm" className="knoux-neon-button">
            Add Effect
          </Button>
        </div>

        {effects.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No effects applied</p>
            <p className="text-xs">Add effects to enhance your clip</p>
          </div>
        ) : (
          <div className="space-y-3">
            {effects.map((effect, index) => (
              <div key={effect.id} className="knoux-glass-panel p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{effect.type}</span>
                  <Switch checked={effect.enabled} />
                </div>
                <div className="space-y-2">
                  {Object.entries(effect.parameters || {}).map(
                    ([key, value]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between"
                      >
                        <Label className="text-xs text-muted-foreground capitalize">
                          {key.replace(/([A-Z])/g, " $1").trim()}
                        </Label>
                        <Input
                          type="number"
                          value={value as number}
                          onChange={(e) => {
                            // Handle parameter change
                            console.log(
                              `${effect.type}.${key}:`,
                              e.target.value,
                            );
                          }}
                          className="w-20 h-6 text-xs bg-background/50"
                          step={0.1}
                          min={0}
                          max={1}
                        />
                      </div>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Common Effects */}
        <div className="space-y-2 pt-4 border-t border-cyan-500/20">
          <Label className="text-sm font-semibold text-cyan-300">
            Quick Effects
          </Label>

          <div className="grid grid-cols-2 gap-2">
            {["Blur", "Sharpen", "Glow", "Shadow"].map((effectName) => (
              <Button
                key={effectName}
                size="sm"
                variant="ghost"
                className="knoux-icon-button text-xs"
              >
                {effectName}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

function AIControlsPanel({
  clip,
  onPropertyChange,
}: {
  clip: KnouxClipData;
  onPropertyChange?: (property: string, value: any) => void;
}) {
  const aiSettings = clip.aiSettings;

  return (
    <ScrollArea className="h-full knoux-scrollbar">
      <div className="p-4 space-y-6">
        <div className="knoux-ai-indicator">
          <Bot className="w-4 h-4" />
          AI-Powered Controls
        </div>

        {/* Face FX Controls */}
        {(clip.type === "face-fx" || aiSettings?.faceFX) && (
          <FaceFXControls
            settings={aiSettings?.faceFX}
            onSettingChange={(key, value) =>
              onPropertyChange?.(`aiSettings.faceFX.${key}`, value)
            }
          />
        )}

        {/* Body FX Controls */}
        {(clip.type === "body-fx" || aiSettings?.bodyFX) && (
          <BodyFXControls
            settings={aiSettings?.bodyFX}
            onSettingChange={(key, value) =>
              onPropertyChange?.(`aiSettings.bodyFX.${key}`, value)
            }
          />
        )}

        {/* Makeup Controls */}
        {aiSettings?.makeupFX && (
          <MakeupControls
            settings={aiSettings.makeupFX}
            onSettingChange={(key, value) =>
              onPropertyChange?.(`aiSettings.makeupFX.${key}`, value)
            }
          />
        )}

        {/* Add AI Effect Button */}
        <div className="pt-4 border-t border-cyan-500/20">
          <Button className="w-full knoux-secondary-button">
            <Bot className="w-4 h-4 mr-2" />
            Add AI Effect
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}

function FaceFXControls({
  settings,
  onSettingChange,
}: {
  settings?: any;
  onSettingChange: (key: string, value: any) => void;
}) {
  return (
    <div className="space-y-4">
      <Label className="text-sm font-semibold text-pink-300">Face FX</Label>

      <div className="space-y-3">
        {/* Enhancement Level */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">
            Enhancement Level:{" "}
            {((settings?.enhancement?.level || 0.5) * 100).toFixed(0)}%
          </Label>
          <Slider
            value={[(settings?.enhancement?.level || 0.5) * 100]}
            onValueChange={([value]) =>
              onSettingChange("enhancement.level", value / 100)
            }
            max={100}
            min={0}
            step={1}
            className="w-full"
          />
        </div>

        {/* Eye Size */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">
            Eye Size: {((settings?.morphing?.eyeSize || 1) * 100).toFixed(0)}%
          </Label>
          <Slider
            value={[(settings?.morphing?.eyeSize || 1) * 100]}
            onValueChange={([value]) =>
              onSettingChange("morphing.eyeSize", value / 100)
            }
            max={200}
            min={50}
            step={5}
            className="w-full"
          />
        </div>

        {/* Skin Smoothing */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">
            Skin Smoothing:{" "}
            {((settings?.enhancement?.skinSmoothing || 0.5) * 100).toFixed(0)}%
          </Label>
          <Slider
            value={[(settings?.enhancement?.skinSmoothing || 0.5) * 100]}
            onValueChange={([value]) =>
              onSettingChange("enhancement.skinSmoothing", value / 100)
            }
            max={100}
            min={0}
            step={1}
            className="w-full"
          />
        </div>

        {/* Skin Tone */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">
            Skin Tone
          </Label>
          <Select
            value={settings?.beautification?.skinTone || "auto"}
            onValueChange={(value) =>
              onSettingChange("beautification.skinTone", value)
            }
          >
            <SelectTrigger className="bg-background/50 border-pink-500/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto Detect</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function BodyFXControls({
  settings,
  onSettingChange,
}: {
  settings?: any;
  onSettingChange: (key: string, value: any) => void;
}) {
  return (
    <div className="space-y-4">
      <Label className="text-sm font-semibold text-purple-300">Body FX</Label>

      <div className="space-y-3">
        {/* Waist Size */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">
            Waist Size:{" "}
            {((settings?.modifications?.waistSize || 1) * 100).toFixed(0)}%
          </Label>
          <Slider
            value={[(settings?.modifications?.waistSize || 1) * 100]}
            onValueChange={([value]) =>
              onSettingChange("modifications.waistSize", value / 100)
            }
            max={150}
            min={50}
            step={5}
            className="w-full"
          />
        </div>

        {/* Height */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">
            Height: {((settings?.modifications?.height || 1) * 100).toFixed(0)}%
          </Label>
          <Slider
            value={[(settings?.modifications?.height || 1) * 100]}
            onValueChange={([value]) =>
              onSettingChange("modifications.height", value / 100)
            }
            max={120}
            min={80}
            step={2}
            className="w-full"
          />
        </div>

        {/* Preset */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">
            Preset
          </Label>
          <Select
            value={settings?.presets || "natural"}
            onValueChange={(value) => onSettingChange("presets", value)}
          >
            <SelectTrigger className="bg-background/50 border-purple-500/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="natural">Natural</SelectItem>
              <SelectItem value="slim">Slim</SelectItem>
              <SelectItem value="sport">Sport</SelectItem>
              <SelectItem value="fashion">Fashion</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function MakeupControls({
  settings,
  onSettingChange,
}: {
  settings?: any;
  onSettingChange: (key: string, value: any) => void;
}) {
  return (
    <div className="space-y-4">
      <Label className="text-sm font-semibold text-yellow-300">Makeup</Label>

      <div className="space-y-3">
        {/* Style */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">
            Style
          </Label>
          <Select
            value={settings?.style || "natural"}
            onValueChange={(value) => onSettingChange("style", value)}
          >
            <SelectTrigger className="bg-background/50 border-yellow-500/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="natural">Natural</SelectItem>
              <SelectItem value="party">Party</SelectItem>
              <SelectItem value="wedding">Wedding</SelectItem>
              <SelectItem value="fantasy">Fantasy</SelectItem>
              <SelectItem value="kpop">K-Pop</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Intensity */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">
            Intensity: {((settings?.intensity || 0.5) * 100).toFixed(0)}%
          </Label>
          <Slider
            value={[(settings?.intensity || 0.5) * 100]}
            onValueChange={([value]) =>
              onSettingChange("intensity", value / 100)
            }
            max={100}
            min={0}
            step={1}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}

function ColorPanel({
  clip,
  onPropertyChange,
}: {
  clip: KnouxClipData;
  onPropertyChange?: (property: string, value: any) => void;
}) {
  return (
    <ScrollArea className="h-full knoux-scrollbar">
      <div className="p-4 space-y-6">
        <Label className="text-sm font-semibold text-cyan-300">
          Color Grading
        </Label>

        {/* Coming Soon placeholder */}
        <div className="text-center text-muted-foreground py-8">
          <Palette className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>Color controls coming soon</p>
        </div>
      </div>
    </ScrollArea>
  );
}
