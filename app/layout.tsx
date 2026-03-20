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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  try {
    var ua = navigator.userAgent || "";
    var isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
    if (!isIOS) return;
    if (!("serviceWorker" in navigator)) return;
    var key = "kakeibo_ios_sw_reset_v1";
    if (localStorage.getItem(key) === "1") return;
    localStorage.setItem(key, "1");

    Promise.resolve()
      .then(function () {
        return navigator.serviceWorker.getRegistrations();
      })
      .then(function (regs) {
        return Promise.all((regs || []).map(function (r) {
          try { return r.unregister(); } catch (e) { return false; }
        }));
      })
      .then(function () {
        if (!window.caches || !caches.keys) return;
        return caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (k) {
            try { return caches.delete(k); } catch (e) { return false; }
          }));
        });
      })
      .finally(function () {
        var url = new URL(window.location.href);
        url.searchParams.set("swreset", Date.now().toString());
        window.location.replace(url.toString());
      });
  } catch (e) {
    // ignore
  }
})();
`,
          }}
        />
      </head>
      <body className={inter.className}>
        {children}
      </body>
    </html>
  );
}

