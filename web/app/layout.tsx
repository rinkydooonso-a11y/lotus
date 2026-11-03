import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { FilmHost } from "@/components/Film";

export const metadata: Metadata = { title: "CardQuest", description: "Walk to crates on the map. Open them for real graded trading cards.", manifest: "/manifest.webmanifest", icons: { icon: "/icon-512.png", apple: "/apple-icon.png" }, appleWebApp: { capable: true, title: "CardQuest", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { themeColor: "#0a0a0b", width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Archivo (variable width + weight) for everything; JetBrains Mono for small labels and numbers. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=JetBrains+Mono:wght@400;500;700&display=swap" />
      </head>
      <body>
        <Providers>
          <div className="app">
            <Header />
            <main>{children}</main>
          </div>
          <FilmHost />
        </Providers>
      </body>
    </html>
  );
}
