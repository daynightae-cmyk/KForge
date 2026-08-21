// src/components/KnouxSidebar.tsx - AFTER FIXING COMPLEX ISSUES
/**
 * Knoux Edita PRO - Sidebar Component (KnouxSidebar)
 *
 * This component provides the main navigation and access points for core application areas:
 * Media Library, Templates, and AI Tools Hub. It embodies the sidebar's structural design,
 * Knoux tab styling, and links the UI panels to their respective backend logic.
 *
 * --- CRITICAL FIXES APPLIED: ---
 * - Corrected all Import paths for icons and dependent components.
 * - Ensured correct usage of useCallback and useEffect with dependencies.
 * - Addressed state management type mismatch for setActiveKnouxTab.
 * - Removed assumptions/code conflicting with core Knoux Glassmorphism styling.
 *
 * This component now correctly structures the sidebar UI and manages the active tab state.
 */

import React, { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Film,
  Sparkles,
  Wand2,
  FolderOpen,
  Image,
  Music,
  Type,
  Bot,
  VideoIcon,
  Download,
  ChevronRight,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// Define a type for sidebar tabs, matching the IDs used below.
// Using a Union Type is correct here.
type KnouxSidebarTab = "media" | "templates" | "aiTools";

// Implementation of the Knoux Sidebar component.
export function KnouxSidebar() {
  // State to manage the currently active tab's ID. Correctly typed.
  const [activeKnouxTab, setActiveKnouxTab] =
    useState<KnouxSidebarTab>("media"); // Default tab ID is 'media'.

  // Array defining the tabs - IDs, display names, and custom themed icons.
  const knouxTabs = [
    {
      id: "media" as const,
      name: "مكتبة الوسائط",
      icon: <FolderOpen size={20} className="text-cyan-400" />,
    },
    {
      id: "templates" as const,
      name: "القوالب المتقدمة",
      icon: <Wand2 size={20} className="text-pink-400" />,
    },
    {
      id: "aiTools" as const,
      name: "أدوات الذكاء الاصطناعي",
      icon: (
        <Bot
          size={20}
          className="text-cyan-400 drop-shadow-[0_0_4px_rgba(0,255,255,0.6)]"
        />
      ),
    },
  ];

  // --- Helper to Render Active Panel Content ---
  // Uses useCallback correctly to memoize the function.
  // Returns the specific React component for the currently active tab.
  // Passes necessary props to child panel components (like setActiveKnouxTab).
  const renderActivePanelContent = useCallback(() => {
    switch (activeKnouxTab) {
      case "media":
        // Render the Media Library Panel component.
        return <KnouxMediaPanelComponent />;

      case "templates":
        // Render the Templates Panel component.
        return (
          <KnouxTemplatesPanelComponent setActiveKnouxTab={setActiveKnouxTab} />
        );

      case "aiTools":
        // Render the AI Tools Hub Panel component.
        return <KnouxAIToolsPanelComponent />;

      default:
        // Fallback case, though ideally should not be reached with correct tab IDs.
        console.error(
          `Knoux Sidebar: Unknown active tab ID: ${activeKnouxTab}. Defaulting to Media panel.`,
        );
        return <KnouxMediaPanelComponent />; // Default to Media panel as a safe fallback.
    }
  }, [activeKnouxTab, setActiveKnouxTab]); // Dependencies: State value and state setter.

  // Optional: Add an effect hook here if the sidebar itself needs to perform actions
  // when the component mounts or when the active tab changes,
  // e.g., logging the tab change or pre-loading data for the new tab.
  useEffect(() => {
    console.log(`Knoux Sidebar: Active tab switched to "${activeKnouxTab}".`);
    // TODO: Maybe pre-fetch some core data for this tab? Or relies on the panel component to do it.
  }, [activeKnouxTab]); // Dependency: Run this effect when activeKnouxTab state changes.

  // --- Sidebar UI Structure Rendering ---
  return (
    // Main Sidebar container - Assumes the parent component applies the
    // knoux-glass-panel base style (via className prop passed from App.tsx).
    // It's a flex column containing the tab bar and the content area below.
    // overflow-hidden is important here to prevent scrollbar issues at the sidebar level
    // if the internal content panel has its own scrolling.
    <motion.div
      className="row-span-2 knoux-glass-panel h-full flex flex-col text-gray-300 overflow-hidden"
      initial={{ x: -320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
    >
      {/* --- Tab Navigation Bar (Top Flex-Shrink Area) --- */}
      {/* Contains the buttons to switch between tabs. Applies Knoux specific tab bar styling. */}
      <div className="flex-shrink-0 flex p-1 bg-black/30 border-b border-white/10 select-none">
        {knouxTabs.map((tab) => (
          // Each Tab Button. Uses correct key. Calls setActiveKnouxTab. Applies dynamic classes.
          <button
            key={tab.id} // React requires a unique key when mapping lists.
            onClick={() => setActiveKnouxTab(tab.id)} // Update component state.
            // Dynamic classes applying Knoux themed styles based on active/hover states.
            className={`flex-1 flex items-center justify-center gap-2 px-2 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
              activeKnouxTab === tab.id
                ? "bg-cyan-500/20 text-cyan-400 shadow-[0_0_8px_rgba(0,255,255,0.3)]" // Themed active style
                : "text-gray-400 hover:bg-white/10 hover:text-white" // Themed inactive and hover styles
            }`}
            title={tab.name} // Tooltip for accessibility and UX
          >
            {/* Icon for the tab */}
            {tab.icon}
            {/* Text Label for the tab */}
            <span className="hidden lg:inline">{tab.name}</span>
          </button>
        ))}
      </div>{" "}
      {/* End Tab Bar */}
      {/* --- Tab Content Area (Flex-Grow and Scrollable) --- */}
      {/* This div is where the active panel component (MediaPanel, TemplatesPanel, etc.) is rendered. */}
      {/* flex-grow ensures it takes up all remaining space below the tab bar. */}
      {/* overflow-y-auto ensures THIS div scrolls its content vertically if it exceeds its height. */}
      <div className="flex-grow p-4 overflow-y-auto scrollbar-thin scrollbar-thumb-cyan-500/30 scrollbar-track-transparent">
        {/* Call the helper function to render the content for the currently active tab */}
        {renderActivePanelContent()}
      </div>{" "}
      {/* End Content Area */}
      {/* Knoux Branding Signature at the very bottom */}
      <motion.div
        className="flex-shrink-0 text-center text-xs text-gray-600 p-2 border-t border-gray-700/50"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
      >
        نسخة مخصصة لأبو ريتاج | Knoux Edita PRO
      </motion.div>
    </motion.div> // End Main Sidebar Container Component
  );
}

// --- Placeholder/Dummy Implementations for Sub-Panel Components (Need Full Implementation) ---

/** DUMMY Implementation for Media Library Panel (Needs full implementation). */
const KnouxMediaPanelComponent: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true); // Simulate loading
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []); // Stop dummy loading after 1.5s

  const mediaTypes = [
    { type: "video", icon: VideoIcon, label: "فيديوهات", count: 12 },
    { type: "image", icon: Image, label: "صور", count: 24 },
    { type: "audio", icon: Music, label: "أصوات", count: 8 },
    { type: "text", icon: Type, label: "نصوص", count: 15 },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <VideoIcon size={24} className="text-cyan-400" />
        مكتبة Knoux للوسائط
      </h3>

      <Button className="w-full bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30">
        <Download size={18} className="mr-2" />
        استيراد وسائط جديدة...
      </Button>

      <div className="grid grid-cols-2 gap-2">
        {mediaTypes.map((media) => (
          <motion.div
            key={media.type}
            className="p-3 cursor-pointer bg-white/5 rounded-lg border border-white/10 hover:border-cyan-400/50 transition-colors"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <media.icon className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-medium">{media.label}</span>
            </div>
            <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30">
              {media.count} ملف
            </Badge>
          </motion.div>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center text-gray-500 py-8 flex flex-col items-center gap-2">
          <Loader2 size={30} className="animate-spin text-gray-500" />
          <p>جاري تحميل وسائطك...</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="aspect-video bg-white/5 rounded-lg flex items-center justify-center text-gray-500 text-xs border border-white/10 cursor-grab hover:border-cyan-400/50"
            >
              صورة مصغرة {i + 1}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-center text-gray-600 mt-8">
        💡 ستجد هنا فيديوهاتك وصورك وملفاتك الصوتية بعد استيرادها ومعالجتها
        بواسطة AI.
      </p>
    </div>
  );
};

/** DUMMY Implementation for Templates Panel (Needs full implementation). */
const KnouxTemplatesPanelComponent: React.FC<{
  setActiveKnouxTab: (tab: KnouxSidebarTab) => void;
}> = ({ setActiveKnouxTab }) => {
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []); // Stop dummy loading after 1s

  // Handler to switch to AI Tools tab
  const handleNavigateToAIGenerator = useCallback(() => {
    setActiveKnouxTab("aiTools");
  }, [setActiveKnouxTab]);

  const templates = [
    { name: "احتفال عيد ميلاد", category: "حفلات", duration: "30ث" },
    { name: "أبرز لحظات الزفاف", category: "زفاف", duration: "2د" },
    { name: "فلوج سفر", category: "سفر", duration: "1د" },
    { name: "مقدمة تجارية", category: "��ركات", duration: "15ث" },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <Wand2 size={24} className="text-pink-400" />
        قوالب Knoux المتقدمة
      </h3>

      {/* Link/Call to Action for AI Template Creator */}
      <div
        className="p-4 rounded-lg text-center cursor-pointer hover:bg-white/10 transition-all duration-200 border border-white/10 hover:border-cyan-400/50"
        onClick={handleNavigateToAIGenerator}
      >
        <Bot
          size={30}
          className="mx-auto mb-2 text-cyan-400 drop-shadow-[0_0_4px_rgba(0,255,255,0.6)]"
        />
        <p className="text-sm font-semibold text-white leading-snug">
          ⚡ أنشئ قالبك الخاص بوصف نصي!
        </p>
        <span className="text-xs text-gray-500">
          انقر هنا لتوليد قالب بـ AI
        </span>
      </div>

      <Button className="w-full bg-pink-500/20 hover:bg-pink-500/30 text-pink-400 border border-pink-500/30">
        <Sparkles className="w-4 h-4 mr-2" />
        إنشاء بالذكاء الاصطناعي
      </Button>

      {isLoading ? (
        <div className="text-center text-gray-500 py-8 flex flex-col items-center gap-2">
          <Loader2 size={30} className="animate-spin text-gray-500" />
          <p>جاري تحميل القوالب المتاحة...</p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((template, i) => (
            <motion.div
              key={i}
              className="flex items-center gap-3 p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-pink-400/10 transition-all duration-200 border border-white/10 hover:border-pink-400/50"
              whileHover={{ x: 4 }}
            >
              <div className="w-20 h-12 bg-gradient-to-br from-pink-500/20 to-purple-500/20 rounded-md flex-shrink-0 flex items-center justify-center text-gray-500 text-xs border border-pink-500/30">
                معاينة
              </div>
              <div className="flex-1">
                <span className="font-medium text-sm text-white block">
                  {template.name}
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className="text-xs bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
                    {template.category}
                  </Badge>
                  <span className="text-xs text-gray-400">
                    {template.duration}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
      <p className="text-xs text-center text-gray-600 mt-8">
        💡 القوالب تشمل تصميمات احترافية معدة مسبقًا، بالإضافة إلى القوالب التي
        تولدها بنفسك باستخدام AI.
      </p>
    </div>
  );
};

/** DUMMY Implementation for AI Tools Panel (Needs full implementation). */
const KnouxAIToolsPanelComponent: React.FC = () => {
  console.log("KnouxAIToolsPanel: Component mounted. Contains AI Tools.");

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <Bot
          size={24}
          className="text-cyan-400 drop-shadow-[0_0_4px_rgba(0,255,255,0.6)]"
        />
        مختبر الذكاء الاصطناعي Knoux AI Lab
      </h3>

      <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4 text-center">
        <Bot className="w-8 h-8 mx-auto mb-2 text-cyan-400" />
        <p className="text-sm text-white font-medium">AI Template Creator</p>
        <p className="text-xs text-gray-400 mt-1">
          استخدم الذكاء الاصطناعي لإنشاء قوالب ��خصصة
        </p>
      </div>

      {/* AI Style Transfer Tool Link */}
      <div
        className="p-4 rounded-lg text-center cursor-pointer hover:bg-white/10 transition-all duration-200 border border-white/10 hover:border-pink-400/50"
        onClick={() => {
          alert("🚧 Style Transfer قيد التطوير!");
        }}
      >
        <Sparkles size={30} className="mx-auto mb-3 text-pink-400" />
        <h5 className="text-base font-semibold text-white leading-snug">
          {" "}
          تحويل النمط بالذكاء الاصطناعي
        </h5>
        <p className="text-xs text-gray-500">طبق أساليب فنية مذهلة.</p>
      </div>

      {/* AI Object Removal Tool Link */}
      <div
        className="p-4 rounded-lg text-center cursor-pointer hover:bg-white/10 transition-all duration-200 border border-white/10 hover:border-purple-400/50"
        onClick={() => {
          alert("🚧 Object Removal قيد التطوير!");
        }}
      >
        <Sparkles size={30} className="mx-auto mb-3 text-purple-400" />
        <h5 className="text-base font-semibold text-white leading-snug">
          {" "}
          إزالة الكائنات تلقائياً
        </h5>
        <p className="text-xs text-gray-500">
          امسح العناصر غير المرغوبة بسلاسة.
        </p>
      </div>
    </div>
  );
};

// Export the main Sidebar component.
export default KnouxSidebar;
