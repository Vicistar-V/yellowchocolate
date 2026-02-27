import {
  FileStack, Scissors, Trash2, FileOutput, LayoutList, ScanLine,
  Minimize2, Wrench, ScanText,
  Image, FileText, Presentation, Table, Code,
  ImageDown, FileDown, PresentationIcon, TableProperties, Shield,
  RotateCw, Hash, Droplets, Crop, Pencil,
  Unlock, Lock, PenTool, EyeOff, GitCompare,
  Languages,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

interface ToolItem {
  title: string;
  url: string;
  icon: React.ElementType;
  enabled: boolean;
}

interface ToolCategory {
  label: string;
  items: ToolItem[];
}

const toolCategories: ToolCategory[] = [
  {
    label: "Organize PDF",
    items: [
      { title: "Merge PDF", url: "/merge-pdf", icon: FileStack, enabled: true },
      { title: "Split PDF", url: "/split-pdf", icon: Scissors, enabled: true },
      { title: "Remove Pages", url: "/remove-pages", icon: Trash2, enabled: true },
      { title: "Extract Pages", url: "/extract-pages", icon: FileOutput, enabled: true },
      { title: "Organize PDF", url: "/organize", icon: LayoutList, enabled: true },
      { title: "Scan to PDF", url: "/scan", icon: ScanLine, enabled: false },
    ],
  },
  {
    label: "Optimize PDF",
    items: [
      { title: "Compress PDF", url: "/compress", icon: Minimize2, enabled: false },
      { title: "Repair PDF", url: "/repair", icon: Wrench, enabled: false },
      { title: "OCR PDF", url: "/ocr", icon: ScanText, enabled: false },
    ],
  },
  {
    label: "Convert to PDF",
    items: [
      { title: "JPG to PDF", url: "/jpg-to-pdf", icon: Image, enabled: false },
      { title: "WORD to PDF", url: "/word-to-pdf", icon: FileText, enabled: false },
      { title: "POWERPOINT to PDF", url: "/ppt-to-pdf", icon: Presentation, enabled: false },
      { title: "EXCEL to PDF", url: "/excel-to-pdf", icon: Table, enabled: false },
      { title: "HTML to PDF", url: "/html-to-pdf", icon: Code, enabled: false },
    ],
  },
  {
    label: "Convert from PDF",
    items: [
      { title: "PDF to JPG", url: "/pdf-to-jpg", icon: ImageDown, enabled: false },
      { title: "PDF to WORD", url: "/pdf-to-word", icon: FileDown, enabled: false },
      { title: "PDF to POWERPOINT", url: "/pdf-to-ppt", icon: PresentationIcon, enabled: false },
      { title: "PDF to EXCEL", url: "/pdf-to-excel", icon: TableProperties, enabled: false },
      { title: "PDF to PDF/A", url: "/pdf-to-pdfa", icon: Shield, enabled: false },
    ],
  },
  {
    label: "Edit PDF",
    items: [
      { title: "Rotate PDF", url: "/rotate", icon: RotateCw, enabled: false },
      { title: "Add Page Numbers", url: "/page-numbers", icon: Hash, enabled: false },
      { title: "Add Watermark", url: "/watermark", icon: Droplets, enabled: false },
      { title: "Crop PDF", url: "/crop", icon: Crop, enabled: false },
      { title: "Edit PDF", url: "/edit", icon: Pencil, enabled: false },
    ],
  },
  {
    label: "PDF Security",
    items: [
      { title: "Unlock PDF", url: "/unlock", icon: Unlock, enabled: false },
      { title: "Protect PDF", url: "/protect", icon: Lock, enabled: false },
      { title: "Sign PDF", url: "/sign", icon: PenTool, enabled: false },
      { title: "Redact PDF", url: "/redact", icon: EyeOff, enabled: false },
      { title: "Compare PDF", url: "/compare", icon: GitCompare, enabled: false },
    ],
  },
  {
    label: "PDF Intelligence",
    items: [
      { title: "Translate PDF", url: "/translate", icon: Languages, enabled: false },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="p-4 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <span className="font-bold text-primary-foreground text-sm" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>yC</span>
          </div>
          {!collapsed && (
            <span className="font-bold text-sm text-sidebar-foreground truncate" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Open yellowChocolates
            </span>
          )}
        </div>

        {toolCategories.map((category) => (
          <SidebarGroup key={category.label}>
            <SidebarGroupLabel className="text-xs uppercase tracking-wider opacity-60">
              {category.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {category.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    {item.enabled ? (
                      <SidebarMenuButton asChild tooltip={item.title}>
                        <NavLink to={item.url} end activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuButton
                        disabled
                        className="opacity-40 cursor-not-allowed italic"
                        tooltip={item.title}
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
