/* محمّل مكتبات المحرّر مع مسارات احتياطية: PDF.js + pdf-lib */
"use strict";

(function () {
  const LIBS = [
    {
      name: "PDF.js", global: "pdfjsLib", key: "pdfjs",
      urls: [
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
        "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js",
      ],
    },
    {
      name: "pdf-lib", global: "PDFLib", key: "pdflib",
      urls: [
        "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js",
        "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js",
      ],
    },
  ];

  window.__libSrc = window.__libSrc || {};

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.onload = () => resolve(url);
      s.onerror = () => reject(new Error("فشل " + url));
      document.head.appendChild(s);
    });
  }

  async function loadWithFallback(lib) {
    for (const url of lib.urls) {
      try {
        await loadScript(url);
        if (window[lib.global]) { window.__libSrc[lib.key] = url; return true; }
      } catch (e) { /* التالي */ }
    }
    return false;
  }

  function showFatal(missing) {
    const div = document.createElement("div");
    div.style.cssText =
      "position:fixed;inset:auto 16px 16px 16px;background:#7f1d1d;color:#fff;" +
      "padding:16px 20px;border-radius:14px;font-family:Cairo,sans-serif;z-index:9999;text-align:center;";
    div.textContent = "تعذّر تحميل المكتبات (" + missing.join("، ") + "). تأكد من الإنترنت وأعد التحميل.";
    document.body.appendChild(div);
  }

  async function boot() {
    const results = await Promise.all(LIBS.map(loadWithFallback));
    const missing = LIBS.filter((_, i) => !results[i]).map((l) => l.name);
    if (missing.length) { showFatal(missing); return; }
    await loadScript("editor.js");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();
