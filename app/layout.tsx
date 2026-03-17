import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import type { ReactNode } from "react";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "家計ダッシュボード",
  description: "スプレッドシート感覚で使える家計簿 Web アプリ",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Kakeibo",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="ja">
      <body className={inter.className}>{children}</body>
    </html>
  );
}

