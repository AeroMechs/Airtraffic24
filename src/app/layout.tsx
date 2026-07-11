import type { Metadata } from "next";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/atc/components/ui/tooltip";

import "./globals.css";

export const metadata: Metadata = {
  title: "Airtraffic24 | Live Global Flight Radar",
  description:
    "A live worldwide aircraft map with flight search, route details, weather, airport boards and ATC overlays.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="dark h-full antialiased"
      style={{ colorScheme: "dark" }}
    >
      <body className="min-h-full overflow-hidden bg-background text-foreground">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
