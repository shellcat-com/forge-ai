import type { Metadata } from "next";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/press-start-2p/400.css";
import "../design/tokens.css";
import "./public.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "Forge AI — Build from an idea",
  description:
    "A local workspace for turning ideas into editable applications.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning><head><script src="/theme-init.js" /></head>
      <body>{children}</body>
    </html>
  );
}
