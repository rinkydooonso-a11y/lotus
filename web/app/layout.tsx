import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { FilmHost } from "@/components/Film";

export const metadata: Metadata = { title: "CardQuest", description: "Walk to crates on the map. Open them for real graded trading cards.", manifest: "/manifest.webmanifest", icons: { icon: "/icon-512.png", apple: "/apple-icon.png" }, appleWebApp: { capable: true, title: "CardQuest", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { themeColor: "#121212", width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Unbounded for display type and the logo, Onest for text, Martian Mono for small labels and numbers. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700;800;900&family=Onest:wght@400;500;600;700;800&family=Martian+Mono:wght@400;500;700&display=swap" />
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
