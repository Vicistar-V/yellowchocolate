import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";
import Layout from "./components/Layout";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import MergePdf from "./pages/MergePdf";
import SplitPdf from "./pages/SplitPdf";
import RemovePages from "./pages/RemovePages";
import ExtractPages from "./pages/ExtractPages";
import OrganizePages from "./pages/OrganizePages";
import ImageToPdf from "./pages/ImageToPdf";
import CompressPdf from "./pages/CompressPdf";
import RepairPdf from "./pages/RepairPdf";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ScrollToTop />
        <Layout>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/merge-pdf" element={<MergePdf />} />
            <Route path="/split-pdf" element={<SplitPdf />} />
            <Route path="/remove-pages" element={<RemovePages />} />
            <Route path="/extract-pages" element={<ExtractPages />} />
            <Route path="/organize" element={<OrganizePages />} />
            <Route path="/image-to-pdf" element={<ImageToPdf />} />
            <Route path="/compress" element={<CompressPdf />} />
            <Route path="/repair" element={<RepairPdf />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
