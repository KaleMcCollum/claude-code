import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./notes.css";

export const metadata: Metadata = {
  title: {
    default: "Plant Perfect Fargo Manual",
    template: "%s - Plant Perfect Fargo Manual",
  },
  description: "Operations manual and decision log for Plant Perfect Fargo.",
  // Internal tool: keep it out of search engines.
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Plant Perfect", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
