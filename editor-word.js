/* تحرير PDF مباشر — كأنه Word.
 *
 * الفكرة:
 *  - نعرض كل صفحة بشكلها الأصلي (صورة الصفحة تحافظ على الرسوم والصور).
 *  - نستخرج النص الحقيقي من الـ PDF مع مواضعه (PDF.js getTextContent).
 *  - نضع فوق كل مقطع نص "صندوق تحرير" شفاف في نفس مكانه؛ فالمستخدم
 *    يدوس على أي كلمة ويعدّلها مباشرة كأنه في Word.
 *  - بمجرد تعديل مقطع: نغطّي النص الأصلي بلون الخلفية المُلتقَط من الصفحة،
 *    ونُظهر نصّك الجديد. الأجزاء غير المعدّلة تبقى كما هي بالضبط.
 *  - عند الحفظ: نُبقي صفحة الـ PDF الأصلية حادّة، ونرسم فوقها فقط
 *    تعديلاتك (تغطية + النص الجديد) كطبقة شفافة — برسم المتصفح فالعربي مثالي.
 */

"use strict";

pdfjsLib.GlobalWorkerOptions.workerSrc = (
  (window.__libSrc && window.__libSrc.pdfjs) ||
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
).replace("pdf.min.js", "pdf.worker.min.js");

const RENDER_SCALE = 2;

const state = {
  pdfBytes: null,
  pdfDoc: null,
  pages: [],     // { num, widthPt, heightPt, displayScale, baseCanvas, layer, spans:[], textItemsFound }
  undoStack: [],
};

const openScreen = document.getElementById("openScreen");
const openZone = document.getElementById("openZone");
const pdfInput = document.getElementById("pdfInput");
const workspace = document.getElementById("workspace");
const pagesArea = document.getElementById("pagesArea");
const overlayMsg = document.getElementById("overlayMsg");
const overlayText = document.getElementById("overlayText");

// ---------- فتح الملف ----------
openZone.addEventListener("click", () => pdfInput.click());
openZone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") pdfInput.click(); });
pdfInput.addEventListener("change", () => { if (pdfInput.files[0]) loadPdf(pdfInput.files[0]); });
["dragenter", "dragover"].forEach((ev) =>
  openZone.addEventListener(ev, (e) => { e.preventDefault(); openZone.classList.add("dragover"); }));
["dragleave", "drop"].forEach((ev) =>
  openZone.addEventListener(ev, (e) => { e.preventDefault(); openZone.classList.remove("dragover"); }));
openZone.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) loadPdf(e.dataTransfer.files[0]); });

document.getElementById("addTextBtn").addEventListener("click", addNewText);
document.getElementById("undoBtn").addEventListener("click", undo);
document.getElementById("savePdfBtn").addEventListener("click", savePdf);

async function loadPdf(file) {
  showOverlay("جارٍ فتح الملف…");
  try {
    state.pdfBytes = await file.arrayBuffer();
    const copy = state.pdfBytes.slice(0);
    state.pdfDoc = await pdfjsLib.getDocument({ data: copy }).promise;
    state.pages = [];
    pagesArea.innerHTML = "";
    let totalItems = 0;
    for (let i = 1; i <= state.pdfDoc.numPages; i++) {
      const n = await renderPage(i);
      totalItems += n;
    }
    openScreen.classList.add("hidden");
    workspace.classList.remove("hidden");
    if (totalItems === 0) {
      toast("⚠️ هذا الملف لا يحتوي نصاً قابلاً للتعديل (ملف مصوّر). جرّب وضع الإضافة/التغطية.");
    } else {
      toast("جاهز ✍️ — دوس على أي نص لتعديله");
    }
  } catch (err) {
    alert("تعذّر فتح الملف: " + (err && err.message ? err.message : err));
  } finally {
    hideOverlay();
  }
}

async function renderPage(num) {
  const page = await state.pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const widthPt = viewport.width / RENDER_SCALE;
  const heightPt = viewport.height / RENDER_SCALE;
  const maxCssWidth = Math.min(820, window.innerWidth - 48);
  const displayScale = maxCssWidth / widthPt;
  const f = displayScale / RENDER_SCALE; // device → CSS

  const wrap = document.createElement("div");
  wrap.className = "ed-page word-page";
  wrap.style.width = widthPt * displayScale + "px";
  wrap.style.height = heightPt * displayScale + "px";

  const baseCanvas = document.createElement("canvas");
  baseCanvas.className = "base";
  baseCanvas.width = viewport.width;
  baseCanvas.height = viewport.height;
  baseCanvas.style.width = widthPt * displayScale + "px";
  baseCanvas.style.height = heightPt * displayScale + "px";
  const baseCtx = baseCanvas.getContext("2d", { willReadFrequently: true });
  await page.render({ canvasContext: baseCtx, viewport }).promise;

  const layer = document.createElement("div");
  layer.className = "word-layer";
  layer.style.width = widthPt * displayScale + "px";
  layer.style.height = heightPt * displayScale + "px";

  wrap.appendChild(baseCanvas);
  wrap.appendChild(layer);
  pagesArea.appendChild(wrap);

  const pageObj = {
    num, widthPt, heightPt, displayScale, f,
    wrap, baseCanvas, baseCtx, layer, spans: [],
  };
  state.pages.push(pageObj);

  // استخراج النص
  const tc = await page.getTextContent();
  for (const item of tc.items) {
    if (!item.str || !item.str.trim()) continue;
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fhDev = Math.hypot(tx[2], tx[3]);
    if (fhDev < 2) continue;
    const leftDev = tx[4];
    const topDev = tx[5] - fhDev;
    const widthDev = item.width * RENDER_SCALE;
    makeSpan(pageObj, {
      text: item.str,
      leftDev, topDev, widthDev, fhDev,
    });
  }
  return tc.items.length;
}

// ---------- صناديق التحرير ----------
function makeSpan(pageObj, geo) {
  const f = pageObj.f;
  const span = document.createElement("div");
  span.className = "word-span";
  span.contentEditable = "true";
  span.spellcheck = false;
  span.textContent = geo.text;

  const rtl = isArabic(geo.text);
  span.dir = rtl ? "rtl" : "ltr";
  span.style.left = geo.leftDev * f + "px";
  span.style.top = geo.topDev * f + "px";
  span.style.height = geo.fhDev * f + "px";
  span.style.minWidth = geo.widthDev * f + "px";
  span.style.fontSize = geo.fhDev * f * 0.92 + "px";
  span.style.lineHeight = geo.fhDev * f + "px";
  if (rtl) { span.style.textAlign = "right"; }

  // هندسة بنقاط الـ PDF (للحفظ والتغطية)
  span._geo = {
    xPt: geo.leftDev / RENDER_SCALE,
    yTopPt: geo.topDev / RENDER_SCALE,
    wPt: geo.widthDev / RENDER_SCALE,
    hPt: geo.fhDev / RENDER_SCALE,
    rtl,
    original: geo.text,
  };
  span._changed = false;
  span._colors = null;

  span.addEventListener("focus", () => { pushUndoOnce(span); });
  span.addEventListener("input", () => onSpanEdited(pageObj, span));
  // سحب صناديق النص الجديدة
  span.addEventListener("mousedown", (e) => maybeStartDrag(e, pageObj, span));

  pageObj.layer.appendChild(span);
  pageObj.spans.push(span);
  return span;
}

let undoArmed = null;
function pushUndoOnce(span) {
  // خزّن لقطة قبل أول تعديل على هذا الصندوق
  if (undoArmed === span) return;
  undoArmed = span;
  pushUndo();
}

function onSpanEdited(pageObj, span) {
  if (!span._changed) {
    span._changed = true;
    const c = sampleColors(pageObj, span);
    span._colors = c;
    // غطِّ الأصل بلون الخلفية وأظهر نصّك بلون النص الملتقط
    span.style.background = c.bg;
    span.style.color = c.fg;
    span.classList.add("changed");
  }
}

// ---------- التقاط الألوان من الصفحة ----------
function sampleColors(pageObj, span) {
  const g = span._geo;
  const s = RENDER_SCALE;
  const pad = Math.max(2, Math.round(g.hPt * s * 0.25)); // هامش خارج النص
  const x0 = Math.round(g.xPt * s);
  const y0 = Math.round(g.yTopPt * s);
  const w0 = Math.max(1, Math.round(g.wPt * s));
  const h0 = Math.max(1, Math.round(g.hPt * s));
  const x = Math.max(0, x0 - pad);
  const y = Math.max(0, y0 - pad);
  const w = w0 + pad * 2;
  const h = h0 + pad * 2;
  let img;
  try { img = pageObj.baseCtx.getImageData(x, y, w, h); }
  catch (e) { return { bg: "#ffffff", fg: "#000000" }; }
  const data = img.data, W = img.width, H = img.height;

  // الخلفية: متوسط الإطار الخارجي (أعلى/أسفل النص فعلياً = الهامش)
  let br = 0, bg = 0, bb = 0, bn = 0;
  for (let ry = 0; ry < H; ry++) {
    const inVertMargin = ry < pad || ry >= H - pad;
    for (let cx = 0; cx < W; cx++) {
      const inHorizMargin = cx < pad || cx >= W - pad;
      if (!inVertMargin && !inHorizMargin) continue; // تجاهل منطقة النص
      const i = (ry * W + cx) * 4;
      br += data[i]; bg += data[i + 1]; bb += data[i + 2]; bn++;
    }
  }
  if (bn) { br /= bn; bg /= bn; bb /= bn; } else { br = bg = bb = 255; }

  // النص: متوسط البكسلات الأبعد عن الخلفية داخل منطقة النص
  let fr = 0, fg = 0, fb = 0, fn = 0, best = 0;
  const samples = [];
  for (let ry = pad; ry < H - pad; ry++) {
    for (let cx = pad; cx < W - pad; cx++) {
      const i = (ry * W + cx) * 4;
      const d = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg) + Math.abs(data[i + 2] - bb);
      if (d > 60) { samples.push([data[i], data[i + 1], data[i + 2]]); }
      if (d > best) best = d;
    }
  }
  for (const p of samples) { fr += p[0]; fg += p[1]; fb += p[2]; fn++; }
  if (fn > 4) { fr /= fn; fg /= fn; fb /= fn; }
  else { fr = fg = fb = (br + bg + bb) / 3 < 128 ? 255 : 0; } // تباين معقول

  return { bg: rgb(br, bg, bb), fg: rgb(fr, fg, fb) };
}
function rgb(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

// ---------- إضافة نص جديد ----------
function addNewText() {
  const pageObj = state.pages[0];
  if (!pageObj) return;
  pushUndo();
  const f = pageObj.f;
  const span = document.createElement("div");
  span.className = "word-span changed new-text";
  span.contentEditable = "true";
  span.spellcheck = false;
  span.dir = "rtl";
  span.textContent = "اكتب هنا";
  span.style.left = "40px";
  span.style.top = (pageObj.layer.scrollTop || 20) + 20 + "px";
  span.style.fontSize = 18 * f * RENDER_SCALE / RENDER_SCALE + "px";
  span.style.lineHeight = 1.4;
  span.style.color = "#000000";
  span.style.textAlign = "right";
  span._geo = { xPt: 40 / pageObj.displayScale, yTopPt: 40 / pageObj.displayScale, wPt: 200, hPt: 18, rtl: true, original: "" };
  span._changed = true;
  span._colors = { bg: "transparent", fg: "#000000" };
  span._isNew = true;
  span.addEventListener("input", () => {});
  span.addEventListener("mousedown", (e) => maybeStartDrag(e, pageObj, span));
  pageObj.layer.appendChild(span);
  pageObj.spans.push(span);
  span.focus();
  document.execCommand && document.execCommand("selectAll", false, null);
  toast("نص جديد — اكتب، واسحبه لمكانه");
}

// سحب صناديق النص الجديدة فقط (الأصلية ثابتة لتبقى محاذية)
let drag = null;
function maybeStartDrag(e, pageObj, span) {
  if (!span._isNew) return;
  // اسحب فقط عند الضغط مع مفتاح Alt أو من الحافة، حتى لا يعطّل الكتابة
  if (!e.altKey) return;
  e.preventDefault();
  const rect = pageObj.layer.getBoundingClientRect();
  drag = {
    span, pageObj,
    offX: e.clientX - (rect.left + parseFloat(span.style.left)),
    offY: e.clientY - (rect.top + parseFloat(span.style.top)),
  };
}
window.addEventListener("mousemove", (e) => {
  if (!drag) return;
  const rect = drag.pageObj.layer.getBoundingClientRect();
  const x = e.clientX - rect.left - drag.offX;
  const y = e.clientY - rect.top - drag.offY;
  drag.span.style.left = Math.max(0, x) + "px";
  drag.span.style.top = Math.max(0, y) + "px";
  drag.span._geo.xPt = x / drag.pageObj.displayScale;
  drag.span._geo.yTopPt = y / drag.pageObj.displayScale;
});
window.addEventListener("mouseup", () => { drag = null; });

// ---------- تراجع ----------
function snapshot() {
  return state.pages.map((p) => p.spans.map((s) => ({
    html: s.textContent, changed: s._changed, colors: s._colors,
    bg: s.style.background, color: s.style.color, left: s.style.left, top: s.style.top,
    isNew: !!s._isNew,
  })));
}
function pushUndo() {
  state.undoStack.push(snapshot());
  if (state.undoStack.length > 40) state.undoStack.shift();
}
function undo() {
  const snap = state.undoStack.pop();
  if (!snap) return;
  undoArmed = null;
  state.pages.forEach((p, pi) => {
    const recs = snap[pi] || [];
    // أزل صناديق النص الجديدة الزائدة
    while (p.spans.length > recs.length) {
      const sp = p.spans.pop(); sp.remove();
    }
    p.spans.forEach((s, si) => {
      const r = recs[si]; if (!r) return;
      s.textContent = r.html;
      s._changed = r.changed;
      s.style.background = r.bg;
      s.style.color = r.color;
      s.style.left = r.left; s.style.top = r.top;
      s.classList.toggle("changed", r.changed);
    });
  });
  toast("تم التراجع");
}

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("word-span")) {
      // اترك تراجع المتصفح داخل الصندوق
      return;
    }
    e.preventDefault(); undo();
  }
});

// ---------- الحفظ كـ PDF ----------
async function savePdf() {
  showOverlay("جارٍ إنشاء ملف PDF…");
  try {
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.load(state.pdfBytes);
    const pages = pdfDoc.getPages();
    const EXPORT_SCALE = 3;

    for (let i = 0; i < state.pages.length; i++) {
      const po = state.pages[i];
      const changed = po.spans.filter((s) => s._changed);
      if (!changed.length) continue;
      const page = pages[i];
      const { width, height } = page.getSize();

      const exp = document.createElement("canvas");
      exp.width = Math.round(po.widthPt * EXPORT_SCALE);
      exp.height = Math.round(po.heightPt * EXPORT_SCALE);
      const ctx = exp.getContext("2d");

      for (const s of changed) {
        const g = s._geo;
        const text = s.textContent;
        const padX = 1 * EXPORT_SCALE;
        // تغطية الأصل
        if (s._colors && s._colors.bg && s._colors.bg !== "transparent") {
          ctx.fillStyle = s._colors.bg;
          ctx.fillRect(
            g.xPt * EXPORT_SCALE - padX, g.yTopPt * EXPORT_SCALE - padX,
            g.wPt * EXPORT_SCALE + padX * 2, g.hPt * EXPORT_SCALE + padX * 2
          );
        }
        if (!text) continue;
        // النص الجديد (رسم المتصفح = تشكيل عربي مثالي)
        const fontPx = g.hPt * 0.92 * EXPORT_SCALE;
        const fam = isArabic(text) ? "Tajawal, Amiri, Arial" : "Arial, Tajawal";
        ctx.font = `${fontPx}px ${fam}`;
        ctx.fillStyle = (s._colors && s._colors.fg) || "#000000";
        ctx.textBaseline = "top";
        const rtl = isArabic(text);
        ctx.direction = rtl ? "rtl" : "ltr";
        ctx.textAlign = rtl ? "right" : "left";
        const yy = g.yTopPt * EXPORT_SCALE + (g.hPt * 0.04 * EXPORT_SCALE);
        if (rtl) {
          ctx.fillText(text, (g.xPt + g.wPt) * EXPORT_SCALE, yy);
        } else {
          ctx.fillText(text, g.xPt * EXPORT_SCALE, yy);
        }
      }

      const png = await pdfDoc.embedPng(exp.toDataURL("image/png"));
      page.drawImage(png, { x: 0, y: 0, width, height });
    }

    const bytes = await pdfDoc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "معدّل.pdf"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("تم حفظ الملف المعدّل ✅");
  } catch (err) {
    alert("تعذّر الحفظ: " + (err && err.message ? err.message : err));
  } finally {
    hideOverlay();
  }
}

// ---------- أدوات ----------
function isArabic(t) { return /[؀-ۿݐ-ݿ]/.test(t || ""); }
function showOverlay(t) { overlayText.textContent = t; overlayMsg.classList.remove("hidden"); }
function hideOverlay() { overlayMsg.classList.add("hidden"); }
function toast(msg) {
  const t = document.createElement("div");
  t.className = "hint-toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
