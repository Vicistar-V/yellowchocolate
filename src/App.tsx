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
import WordToPdf from "./pages/WordToPdf";
import ExcelToPdf from "./pages/ExcelToPdf";
import PowerPointToPdf from "./pages/PowerPointToPdf";
import HtmlToPdf from "./pages/HtmlToPdf";
import PdfToImage from "./pages/PdfToImage";
import PdfToWord from "./pages/PdfToWord";
import PdfToPowerPoint from "./pages/PdfToPowerPoint";
import PdfToExcel from "./pages/PdfToExcel";
import PdfToPdfa from "./pages/PdfToPdfa";
import RotatePdf from "./pages/RotatePdf";
import AddPageNumbers from "./pages/AddPageNumbers";
import AddWatermark from "./pages/AddWatermark";
import CropPdf from "./pages/CropPdf";
import UnlockPdf from "./pages/UnlockPdf";
import ProtectPdf from "./pages/ProtectPdf";
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
            <Route path="/word-to-pdf" element={<WordToPdf />} />
            <Route path="/excel-to-pdf" element={<ExcelToPdf />} />
            <Route path="/ppt-to-pdf" element={<PowerPointToPdf />} />
            <Route path="/html-to-pdf" element={<HtmlToPdf />} />
            <Route path="/pdf-to-image" element={<PdfToImage />} />
            <Route path="/pdf-to-word" element={<PdfToWord />} />
            <Route path="/pdf-to-ppt" element={<PdfToPowerPoint />} />
            <Route path="/pdf-to-excel" element={<PdfToExcel />} />
            <Route path="/pdf-to-pdfa" element={<PdfToPdfa />} />
            <Route path="/rotate" element={<RotatePdf />} />
            <Route path="/page-numbers" element={<AddPageNumbers />} />
            <Route path="/watermark" element={<AddWatermark />} />
            <Route path="/crop" element={<CropPdf />} />
            <Route path="/unlock" element={<UnlockPdf />} />
            <Route path="/protect" element={<ProtectPdf />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
