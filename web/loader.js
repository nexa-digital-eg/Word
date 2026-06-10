/* محمّل المكتبات مع مسارات احتياطية متعددة.
 * لو فشل تحميل مكتبة من CDN يجرّب البديل تلقائياً، ثم يشغّل التطبيق.
 */

"use strict";

(function () {
  const LIBS = [
    {
      name: "PDF.js",
      global: "pdfjsLib",
      key: "pdfjs",
      urls: [
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
        "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js",
      ],
    },
    {
      name: "Tesseract.js",
      global: "Tesseract",
      key: "tesseract",
      urls: [
        "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
        "https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js",
      ],
    },
    {
      name: "docx",
      global: "docx",
      key: "docx",
      urls: [
        "https://unpkg.com/docx@8.5.0/build/index.umd.js",
        "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js",
        "https://unpkg.com/docx@8.5.0/build/index.js",
        "https://cdn.jsdelivr.net/npm/docx@7.8.2/build/index.js",
        "https://unpkg.com/docx@7.8.2/build/index.js",
      ],
    },
  ];

  window.__libSrc = {};

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = url;
      s.onload = function () { resolve(url); };
      s.onerror = function () { reject(new Error("فشل تحميل " + url)); };
      document.head.appendChild(s);
    });
  }

  async function loadWithFallback(lib) {
    for (const url of lib.urls) {
      try {
        await loadScript(url);
        if (window[lib.global]) {
          window.__libSrc[lib.key] = url;
          return true;
        }
      } catch (e) {
        /* جرّب الرابط التالي */
      }
    }
    return false;
  }

  function showFatal(missing) {
    const div = document.createElement("div");
    div.style.cssText =
      "position:fixed;inset:auto 16px 16px 16px;background:#7f1d1d;color:#fff;" +
      "padding:16px 20px;border-radius:14px;font-family:Cairo,sans-serif;" +
      "z-index:9999;text-align:center;font-size:15px;";
    div.textContent =
      "تعذّر تحميل المكتبات المطلوبة (" + missing.join("، ") +
      "). تأكد من اتصال الإنترنت ثم أعد تحميل الصفحة.";
    document.body.appendChild(div);
  }

  async function boot() {
    const results = await Promise.all(LIBS.map(loadWithFallback));
    const missing = LIBS.filter(function (_, i) { return !results[i]; })
      .map(function (l) { return l.name; });
    if (missing.length) {
      showFatal(missing);
      return;
    }
    await loadScript("app.js");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
