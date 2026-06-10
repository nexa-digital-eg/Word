/* محوّل PDF إلى Word — كل المعالجة تتم داخل المتصفح.
 *
 * المحرّكات:
 *  - text : استخراج طبقة النص عبر PDF.js (الأسرع).
 *  - ocr  : عرض الصفحة كصورة وقراءتها عبر Tesseract.js (الأدق للعربية).
 *  - auto : طبقة النص إن كانت سليمة، وإلا OCR تلقائياً.
 */

"use strict";

// عامل PDF.js من نفس مصدر المكتبة التي نجح تحميلها (انظر loader.js)
pdfjsLib.GlobalWorkerOptions.workerSrc = (
  (window.__libSrc && window.__libSrc.pdfjs) ||
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
).replace("pdf.min.js", "pdf.worker.min.js");

// ---------- عناصر الواجهة ----------
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileListEl = document.getElementById("fileList");
const convertBtn = document.getElementById("convertBtn");
const engineSel = document.getElementById("engine");
const qualitySel = document.getElementById("quality");
const langSel = document.getElementById("lang");
const engineHint = document.getElementById("engineHint");
const progressCard = document.getElementById("progressCard");
const progressLabel = document.getElementById("progressLabel");
const progressPct = document.getElementById("progressPct");
const progressBar = document.getElementById("progressBar");
const progressDetail = document.getElementById("progressDetail");
const resultsCard = document.getElementById("results");
const resultList = document.getElementById("resultList");

let files = [];
let ocrWorker = null;
let ocrWorkerLangs = null;
let converting = false;

const ENGINE_HINTS = {
  auto: "يكتشف النص التالف أو الممسوح ضوئياً ويتحوّل للـ OCR تلقائياً",
  ocr: "يقرأ شكل الصفحة كصورة — لا يتأثر بنوع الخط أو ترميز الملف",
  text: "يستخرج النص مباشرة — سريع لكنه قد لا يصلح للملفات الممسوحة",
};
engineSel.addEventListener("change", () => {
  engineHint.textContent = ENGINE_HINTS[engineSel.value];
});

// ---------- اختيار الملفات ----------
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});
fileInput.addEventListener("change", () => addFiles(fileInput.files));

["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);
dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

function addFiles(list) {
  for (const f of list) {
    const isPdf =
      f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) continue;
    if (files.some((x) => x.name === f.name && x.size === f.size)) continue;
    files.push(f);
  }
  fileInput.value = "";
  renderFileList();
}

function renderFileList() {
  fileListEl.innerHTML = "";
  files.forEach((f, i) => {
    const li = document.createElement("li");
    const icon = document.createElement("span");
    icon.textContent = "📄";
    const name = document.createElement("span");
    name.textContent = f.name;
    const size = document.createElement("span");
    size.className = "size";
    size.textContent = humanSize(f.size);
    const rm = document.createElement("button");
    rm.className = "remove";
    rm.textContent = "✕";
    rm.title = "إزالة";
    rm.addEventListener("click", () => {
      files.splice(i, 1);
      renderFileList();
    });
    li.append(icon, name, size, rm);
    fileListEl.appendChild(li);
  });
  convertBtn.disabled = files.length === 0 || converting;
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + " بايت";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " ك.ب";
  return (bytes / 1048576).toFixed(1) + " م.ب";
}

// ---------- كشف العربية والنص التالف ----------
function containsArabic(text) {
  return /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(
    text
  );
}

// الأشكال التقديمية = دليل على نص مخزّن بترتيب بصري (سيظهر معكوساً/مقطّعاً)
function hasPresentationForms(text) {
  return /[ﭐ-﷿ﹰ-﻿]/.test(text);
}

/* هل طبقة النص مشبوهة (تالفة/مرمّزة بشكل مكسور)؟
 * إن كانت كذلك فالاستخراج المباشر سيُنتج نصاً مخربطاً والأفضل OCR. */
function isSuspiciousTextLayer(text) {
  if (hasPresentationForms(text)) return true;
  // محارف منطقة الاستخدام الخاص = خط مخصّص بلا تحويل يونيكود سليم
  if (/[-]/.test(text)) return true;
  // كلمات عربية قصيرة جداً بكثرة = حروف متناثرة بسبب ترميز مكسور
  const arabicWords = text.match(/[؀-ۿ]+/g) || [];
  if (arabicWords.length >= 8) {
    const avg =
      arabicWords.reduce((s, w) => s + w.length, 0) / arabicWords.length;
    if (avg < 2.5) return true;
  }
  return false;
}

// ---------- استخراج النص ----------
async function pageTextLayer(page) {
  const content = await page.getTextContent();
  let lines = [];
  let current = [];
  let lastY = null;
  for (const item of content.items) {
    const y = item.transform ? item.transform[5] : 0;
    if (lastY !== null && Math.abs(y - lastY) > 2) {
      lines.push(current.join(""));
      current = [];
    }
    current.push(item.str);
    lastY = y;
  }
  if (current.length) lines.push(current.join(""));
  return lines.join("\n");
}

async function pageOcr(page, scale, langs, onProgress) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;

  const worker = await getOcrWorker(langs, onProgress);
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const pageWidth = canvas.width;
  canvas.width = canvas.height = 0; // تحرير الذاكرة

  if (data.blocks && data.blocks.length) {
    return textFromBlocks(data.blocks, pageWidth);
  }
  return data.text || "";
}

/* يعيد بناء النص من كتل الـ OCR مع ترتيب الأعمدة من اليمين لليسار
 * (مهم للمستندات العربية ثنائية الأعمدة مثل السير الذاتية)
 * وفلترة السطور منخفضة الثقة أو الخالية من المحتوى. */
function textFromBlocks(blocks, pageWidth) {
  const units = [];
  const columns = [];

  for (const block of blocks) {
    const lines = [];
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const t = (line.text || "").replace(/\n/g, " ").trim();
        if (!t) continue;
        // أسقط السطور التي لا تحتوي حروفاً أو أرقاماً (رموز من الصور/الأيقونات)
        if (!/[؀-ۿa-zA-Z0-9٠-٩]{2,}/.test(t)) continue;
        // أسقط السطور منخفضة الثقة جداً (ضوضاء غالباً)
        if (typeof line.confidence === "number" && line.confidence < 30) continue;
        lines.push(t);
      }
    }
    if (!lines.length) continue;

    const bb = block.bbox || { x0: 0, x1: pageWidth, y0: 0, y1: 0 };
    const width = bb.x1 - bb.x0;

    if (width > 0.65 * pageWidth) {
      // كتلة بعرض الصفحة (عنوان/ترويسة) — وحدة مستقلة بترتيبها الرأسي
      units.push({ y: bb.y0, x: bb.x1, lines });
      continue;
    }

    // اجمع الكتل الضيقة في أعمدة حسب التداخل الأفقي
    let placed = false;
    for (const col of columns) {
      const overlap = Math.min(bb.x1, col.x1) - Math.max(bb.x0, col.x0);
      const minW = Math.min(width, col.x1 - col.x0) || 1;
      if (overlap > 0.4 * minW) {
        col.blocks.push({ y: bb.y0, lines });
        col.x0 = Math.min(col.x0, bb.x0);
        col.x1 = Math.max(col.x1, bb.x1);
        col.y = Math.min(col.y, bb.y0);
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push({ x0: bb.x0, x1: bb.x1, y: bb.y0, blocks: [{ y: bb.y0, lines }] });
    }
  }

  // كل عمود يصبح وحدة واحدة: أسطره مرتبة من أعلى لأسفل
  for (const col of columns) {
    col.blocks.sort((a, b) => a.y - b.y);
    units.push({
      y: col.y,
      x: col.x1,
      lines: col.blocks.flatMap((b) => b.lines),
    });
  }

  // ترتيب الوحدات: الأعلى أولاً، وعند التقارب الرأسي يمين قبل شمال (RTL)
  units.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 40) return a.y - b.y;
    return b.x - a.x;
  });

  return units.map((u) => u.lines.join("\n")).join("\n\n");
}

async function getOcrWorker(langs, onProgress) {
  if (ocrWorker && ocrWorkerLangs === langs) return ocrWorker;
  if (ocrWorker) {
    await ocrWorker.terminate();
    ocrWorker = null;
  }
  setDetail("⬇️ جارٍ تحميل بيانات اللغة للتعرّف الضوئي (مرة واحدة فقط)…");
  ocrWorker = await Tesseract.createWorker(langs, 1, {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(m.progress);
      }
    },
  });
  // تقسيم تلقائي كامل للصفحة مع كشف الاتجاه — أفضل للتصميمات متعددة الأعمدة
  await ocrWorker.setParameters({
    tessedit_pageseg_mode: "1",
    preserve_interword_spaces: "1",
  });
  ocrWorkerLangs = langs;
  return ocrWorker;
}

// ---------- بناء ملف الوورد ----------
function buildDocx(pagesTexts) {
  const { Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak } =
    docx;

  const children = [];
  pagesTexts.forEach((pageText, pageIdx) => {
    const lines = pageText.replace(/\r/g, "").split("\n");
    let wroteAny = false;
    for (const rawLine of lines) {
      // إزالة محارف التحكم غير الصالحة في XML
      const line = rawLine.replace(
        /[^\t -퟿-�\u{10000}-\u{10FFFF}]/gu,
        ""
      );
      const isArabic = containsArabic(line);
      children.push(
        new Paragraph({
          bidirectional: isArabic,
          alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [
            new TextRun({
              text: line,
              rightToLeft: isArabic,
              font: "Arial",
              size: 24, // نصف نقطة → 12pt
            }),
          ],
        })
      );
      wroteAny = true;
    }
    if (!wroteAny) children.push(new Paragraph(""));
    if (pageIdx < pagesTexts.length - 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  });

  return new Document({
    sections: [{ properties: {}, children }],
  });
}

// ---------- التقدم ----------
function showProgress(show) {
  progressCard.classList.toggle("hidden", !show);
}
function setProgress(frac, label) {
  const pct = Math.round(frac * 100);
  progressBar.style.width = pct + "%";
  progressPct.textContent = pct + "%";
  if (label) progressLabel.textContent = label;
}
function setDetail(text) {
  progressDetail.textContent = text;
}

// ---------- التحويل ----------
convertBtn.addEventListener("click", convertAll);

async function convertAll() {
  if (converting || files.length === 0) return;
  converting = true;
  convertBtn.disabled = true;
  resultList.innerHTML = "";
  resultsCard.classList.add("hidden");
  showProgress(true);

  const engine = engineSel.value;
  const scale = parseFloat(qualitySel.value);
  const langs = langSel.value;

  // إجمالي الصفحات للتقدم الكلي
  let totalPages = 0;
  let donePages = 0;
  const docs = [];
  try {
    for (const f of files) {
      const buf = await f.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      docs.push({ file: f, pdf });
      totalPages += pdf.numPages;
    }
  } catch (err) {
    setProgress(0, "تعذّر فتح أحد الملفات");
    setDetail("الخطأ: " + (err && err.message ? err.message : err));
    converting = false;
    convertBtn.disabled = false;
    return;
  }

  for (const { file, pdf } of docs) {
    try {
      const pagesTexts = [];
      let pagesOcr = 0;
      let pagesText = 0;

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        setProgress(
          donePages / totalPages,
          `جارٍ تحويل: ${file.name}`
        );
        setDetail(`الصفحة ${p} من ${pdf.numPages}`);

        let text = "";
        let usedOcr = false;

        if (engine === "text") {
          text = await pageTextLayer(page);
        } else if (engine === "ocr") {
          usedOcr = true;
        } else {
          // auto: جرّب طبقة النص أولاً
          const layer = await pageTextLayer(page);
          if (layer.trim().length >= 12 && !isSuspiciousTextLayer(layer)) {
            text = layer;
          } else {
            usedOcr = true;
          }
        }

        if (usedOcr) {
          const base = donePages / totalPages;
          const span = 1 / totalPages;
          text = await pageOcr(page, scale, langs, (frac) => {
            setProgress(base + frac * span);
            setDetail(
              `الصفحة ${p} من ${pdf.numPages} — قراءة ضوئية ${Math.round(
                frac * 100
              )}%`
            );
          });
          pagesOcr++;
        } else {
          pagesText++;
        }

        pagesTexts.push(text);
        page.cleanup();
        donePages++;
        setProgress(donePages / totalPages);
      }

      setDetail("📝 جارٍ إنشاء ملف الوورد…");
      const doc = buildDocx(pagesTexts);
      const blob = await docx.Packer.toBlob(doc);
      const outName = file.name.replace(/\.pdf$/i, "") + ".docx";
      addResult(outName, blob, {
        pages: pdf.numPages,
        ocr: pagesOcr,
        text: pagesText,
      });
    } catch (err) {
      console.error(err);
      addFailure(file.name, err);
      donePages += pdf.numPages;
    } finally {
      pdf.destroy();
    }
  }

  setProgress(1, "اكتمل التحويل 🎉");
  setDetail("");
  resultsCard.classList.remove("hidden");
  converting = false;
  files = [];
  renderFileList();
}

function addResult(name, blob, stats) {
  const li = document.createElement("li");
  const icon = document.createElement("span");
  icon.textContent = "📝";
  const info = document.createElement("div");
  const title = document.createElement("div");
  title.textContent = name;
  title.style.fontWeight = "700";
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${stats.pages} صفحة — OCR: ${stats.ocr} | نصّي: ${stats.text}`;
  info.append(title, meta);

  const btn = document.createElement("button");
  btn.className = "btn-download";
  btn.textContent = "⬇ تحميل";
  const url = URL.createObjectURL(blob);
  btn.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  });

  li.append(icon, info, btn);
  resultList.appendChild(li);

  // تحميل تلقائي للملف الأول
  if (resultList.children.length === 1) btn.click();
}

function addFailure(name, err) {
  const li = document.createElement("li");
  li.className = "failed";
  li.textContent = `❌ فشل تحويل ${name}: ${
    err && err.message ? err.message : err
  }`;
  resultList.appendChild(li);
  resultsCard.classList.remove("hidden");
}
