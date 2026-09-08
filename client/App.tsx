import { Toaster } from "@/components/ui/toaster";
import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./global.css";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

const KForgeWorkbench = lazy(() => import("./pages/KForgeWorkbench"));
const KnouxForgeInstallation = lazy(() => import("./pages/KnouxForgeInstallation"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function RouteFallback() {
  return (
    <div className="sr-only" role="status" aria-live="polite">
      Loading KNOuX Forge
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<KnouxForgeInstallation />} />
            <Route path="/workspace" element={<KForgeWorkbench />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

createRoot(document.getElementById("root")!).render(<App />);
