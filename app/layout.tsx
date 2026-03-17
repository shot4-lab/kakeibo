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
    function ensureOkMark() {
      try {
        var id = '__kakeibo_js_ok__';
        if (document.getElementById(id)) return;
        var el = document.createElement('div');
        el.id = id;
        el.textContent = 'JS OK';
        el.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99999;background:rgba(34,197,94,0.95);color:#fff;padding:6px 10px;border-radius:9999px;font-size:12px;line-height:1;';
        document.addEventListener('DOMContentLoaded', function () {
          try { document.body.appendChild(el); } catch (e) {}
        });
      } catch (e) {}
    }
    function show(msg) {
      try {
        ensureOkMark();
        var id = '__kakeibo_err__';
        var el = document.getElementById(id);
        if (!el) {
          el = document.createElement('pre');
          el.id = id;
          el.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;max-height:50vh;overflow:auto;z-index:99999;background:rgba(15,23,42,0.95);color:#fff;padding:12px;border-radius:12px;font-size:12px;white-space:pre-wrap;line-height:1.35;';
          document.addEventListener('DOMContentLoaded', function () {
            try { document.body.appendChild(el); } catch (e) {}
          });
        }
        el.textContent = String(msg);
      } catch (e) {}
    }

    ensureOkMark();

    window.addEventListener('error', function (e) {
      var m = e && e.message ? e.message : 'Unknown error';
      var f = e && e.filename ? e.filename : '';
      var l = e && e.lineno ? e.lineno : '';
      var c = e && e.colno ? e.colno : '';
      show('[JS ERROR]\n' + m + (f ? ('\n' + f + ':' + l + ':' + c) : ''));
    });
    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason ? e.reason : 'Unknown rejection';
      show('[UNHANDLED PROMISE]\n' + (r && r.stack ? r.stack : String(r)));
    });
  } catch (e) {
    // ignore
  }
})();
`,
          }}
        />
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

