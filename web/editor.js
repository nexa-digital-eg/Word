/* محرّر PDF داخل المتصفح — يحافظ على شكل الملف الأصلي بالظبط
 * ويتيح إضافة/مسح/تعديل النصوص والتغطية، ثم الحفظ كـ PDF.
 *
 * الفكرة:
 *  - نعرض كل صفحة بشكلها الأصلي عبر PDF.js (طبقة "base").
 *  - التعديلات تُخزَّن ككائنات (نص/مستطيل) بإحداثيات بنقاط الـ PDF،
 *    وتُرسم على طبقة "overlay" شفافة فوق الصفحة.
 *  - عند الحفظ: نُبقي صفحات الـ PDF الأصلية كما هي (حدّة كاملة) عبر pdf-lib،
 *    ونرسم طبقة التعديلات كصورة شفافة عالية الدقة فوق كل صفحة.
 *    رسم النص يتم بواسطة المتصفح (تشكيل عربي مثالي) فلا يتلف أبداً.
 */

"use strict";

pdfjsLib.GlobalWorkerOptions.workerSrc = (
  (window.__libSrc && window.__libSrc.pdfjs) ||
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
).replace("pdf.min.js", "pdf.worker.min.js");

// ---------- الحالة ----------
const state = {
  pdfBytes: null,        // ArrayBuffer الأصلي (للحفظ عبر pdf-lib)
  pdfDoc: null,          // مستند PDF.js
  pages: [],             // { num, widthPt, heightPt, displayScale, baseCanvas, overlayCanvas, edits: [] }
  tool: "select",
  selected: null,        // { pageIndex, edit }
  props: { fontFamily: "Tajawal", fontSize: 18, color: "#000000", bold: false, eraseColor: "#ffffff" },
  undoStack: [],
  drag: null,
  RENDER_SCALE: 2,       // دقة عرض الصفحة (وضوح)
};

// ---------- عناصر ----------
const openScreen = document.getElementById("openScreen");
const openZone = document.getElementById("openZone");
const pdfInput = document.getElementById("pdfInput");
const workspace = document.getElementById("workspace");
const pagesArea = document.getElementById("pagesArea");
const propsBar = document.getElementById("propsBar");
const overlayMsg = document.getElementById("overlayMsg");
const overlayText = document.getElementById("overlayText");

const fontFamilySel = document.getElementById("fontFamily");
const fontSizeInp = document.getElementById("fontSize");
const textColorInp = document.getElementById("textColor");
const boldChk = document.getElementById("boldChk");
const eraseColorWrap = document.getElementById("eraseColorWrap");
const eraseColorInp = document.getElementById("eraseColor");

// ---------- فتح الملف ----------
openZone.addEventListener("click", () => pdfInput.click());
openZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") pdfInput.click();
});
pdfInput.addEventListener("change", () => {
  if (pdfInput.files[0]) loadPdf(pdfInput.files[0]);
});
["dragenter", "dragover"].forEach((ev) =>
  openZone.addEventListener(ev, (e) => { e.preventDefault(); openZone.classList.add("dragover"); })
);
["dragleave", "drop"].forEach((ev) =>
  openZone.addEventListener(ev, (e) => { e.preventDefault(); openZone.classList.remove("dragover"); })
);
openZone.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) loadPdf(f);
});

async function loadPdf(file) {
  showOverlay("جارٍ فتح الملف…");
  try {
    state.pdfBytes = await file.arrayBuffer();
    // PDF.js يستهلك المخزن، فنمرّر نسخة
    const copy = state.pdfBytes.slice(0);
    state.pdfDoc = await pdfjsLib.getDocument({ data: copy }).promise;
    state.pages = [];
    pagesArea.innerHTML = "";
    for (let i = 1; i <= state.pdfDoc.numPages; i++) {
      await renderPage(i);
    }
    openScreen.classList.add("hidden");
    workspace.classList.remove("hidden");
    toast("تم فتح الملف — اختر أداة وابدأ التعديل ✏️");
  } catch (err) {
    alert("تعذّر فتح الملف: " + (err && err.message ? err.message : err));
  } finally {
    hideOverlay();
  }
}

async function renderPage(num) {
  const page = await state.pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale: state.RENDER_SCALE });
  const widthPt = viewport.width / state.RENDER_SCALE;   // أبعاد بنقاط PDF
  const heightPt = viewport.height / state.RENDER_SCALE;

  // عرض ملائم لعرض الشاشة
  const maxCssWidth = Math.min(820, window.innerWidth - 48);
  const displayScale = maxCssWidth / widthPt;

  const wrap = document.createElement("div");
  wrap.className = "ed-page";
  wrap.dataset.tool = state.tool;
  wrap.style.width = widthPt * displayScale + "px";
  wrap.style.height = heightPt * displayScale + "px";

  const baseCanvas = document.createElement("canvas");
  baseCanvas.className = "base";
  baseCanvas.width = viewport.width;
  baseCanvas.height = viewport.height;
  baseCanvas.style.width = widthPt * displayScale + "px";
  baseCanvas.style.height = heightPt * displayScale + "px";
  await page.render({ canvasContext: baseCanvas.getContext("2d"), viewport }).promise;

  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.className = "overlay";
  overlayCanvas.width = viewport.width;
  overlayCanvas.height = viewport.height;
  overlayCanvas.style.width = widthPt * displayScale + "px";
  overlayCanvas.style.height = heightPt * displayScale + "px";

  wrap.appendChild(baseCanvas);
  wrap.appendChild(overlayCanvas);
  pagesArea.appendChild(wrap);

  const pageObj = {
    num, widthPt, heightPt, displayScale,
    wrap, baseCanvas, overlayCanvas, edits: [],
  };
  state.pages.push(pageObj);
  const pageIndex = state.pages.length - 1;

  attachPageEvents(pageObj, pageIndex);
  drawOverlay(pageObj);
}

// ---------- الأدوات ----------
document.querySelectorAll(".tool[data-tool]").forEach((btn) => {
  btn.addEventListener("click", () => setTool(btn.dataset.tool));
});

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll(".tool[data-tool]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tool === tool)
  );
  state.pages.forEach((p) => (p.wrap.dataset.tool = tool));
  // أظهر شريط الخصائص للأدوات المناسبة
  const showProps = tool === "text" || tool === "erase" || tool === "highlight";
  propsBar.classList.toggle("hidden", !showProps && !state.selected);
  eraseColorWrap.classList.toggle("hidden", tool !== "erase" && tool !== "highlight");
}

document.getElementById("deleteBtn").addEventListener("click", deleteSelected);
document.getElementById("undoBtn").addEventListener("click", undo);
document.getElementById("saveBtn").addEventListener("click", savePdf);

// شريط الخصائص → يحدّث الافتراضيات والعنصر المحدد
fontFamilySel.addEventListener("change", () => applyProp("fontFamily", fontFamilySel.value));
fontSizeInp.addEventListener("input", () => applyProp("fontSize", parseFloat(fontSizeInp.value) || 18));
textColorInp.addEventListener("input", () => applyProp("color", textColorInp.value));
boldChk.addEventListener("change", () => applyProp("bold", boldChk.checked));
eraseColorInp.addEventListener("input", () => applyProp("color", eraseColorInp.value));

function applyProp(key, value) {
  if (key === "color" && (state.tool === "erase" || state.tool === "highlight")) {
    state.props.eraseColor = value;
  } else {
    state.props[key] = value;
  }
  if (state.selected) {
    const e = state.selected.edit;
    if (e.type === "text" && ["fontFamily", "fontSize", "color", "bold"].includes(key)) {
      e[key] = value;
    } else if ((e.type === "rect" || e.type === "highlight") && key === "color") {
      e.color = value;
    }
    drawOverlay(state.pages[state.selected.pageIndex]);
  }
}

// ---------- أحداث الصفحة ----------
function attachPageEvents(pageObj, pageIndex) {
  const cv = pageObj.overlayCanvas;

  function toPt(e) {
    const rect = cv.getBoundingClientRect();
    const x = (e.clientX - rect.left) / pageObj.displayScale;
    const y = (e.clientY - rect.top) / pageObj.displayScale;
    return { x, y };
  }

  cv.addEventListener("mousedown", (e) => {
    const { x, y } = toPt(e);

    if (state.tool === "text") {
      pushUndo();
      const edit = {
        type: "text", x, y, text: "",
        fontFamily: state.props.fontFamily, fontSize: state.props.fontSize,
        color: state.props.color, bold: state.props.bold,
        w: 220, h: state.props.fontSize * 1.6,
      };
      pageObj.edits.push(edit);
      selectEdit(pageIndex, edit);
      openInlineEditor(pageObj, edit, true);
      return;
    }

    if (state.tool === "erase" || state.tool === "highlight") {
      pushUndo();
      const edit = {
        type: state.tool === "erase" ? "rect" : "highlight",
        x, y, w: 0, h: 0,
        color: state.props.eraseColor,
      };
      pageObj.edits.push(edit);
      state.drag = { mode: "draw", pageObj, pageIndex, edit, startX: x, startY: y };
      return;
    }

    // أداة التحديد
    const hit = hitTest(pageObj, x, y);
    if (hit) {
      selectEdit(pageIndex, hit);
      state.drag = { mode: "move", pageObj, pageIndex, edit: hit, offX: x - hit.x, offY: y - hit.y };
    } else {
      clearSelection();
    }
  });

  cv.addEventListener("mousemove", (e) => {
    if (!state.drag || state.drag.pageObj !== pageObj) return;
    const { x, y } = toPt(e);
    const d = state.drag;
    if (d.mode === "draw") {
      d.edit.x = Math.min(d.startX, x);
      d.edit.y = Math.min(d.startY, y);
      d.edit.w = Math.abs(x - d.startX);
      d.edit.h = Math.abs(y - d.startY);
    } else if (d.mode === "move") {
      d.edit.x = x - d.offX;
      d.edit.y = y - d.offY;
    }
    drawOverlay(pageObj);
  });

  window.addEventListener("mouseup", () => {
    if (state.drag && state.drag.mode === "draw") {
      const ed = state.drag.edit;
      if (ed.w < 3 || ed.h < 3) {
        // مستطيل صغير جداً → احذفه
        const arr = state.drag.pageObj.edits;
        const i = arr.indexOf(ed);
        if (i >= 0) arr.splice(i, 1);
        drawOverlay(state.drag.pageObj);
      }
    }
    state.drag = null;
  });

  // نقرة مزدوجة لتعديل نص
  cv.addEventListener("dblclick", (e) => {
    const { x, y } = toPt(e);
    const hit = hitTest(pageObj, x, y);
    if (hit && hit.type === "text") {
      selectEdit(pageIndex, hit);
      openInlineEditor(pageObj, hit, false);
    }
  });
}

function hitTest(pageObj, x, y) {
  // من الأحدث للأقدم
  for (let i = pageObj.edits.length - 1; i >= 0; i--) {
    const e = pageObj.edits[i];
    let w = e.w, h = e.h;
    if (e.type === "text") { const m = measureText(e); w = m.w; h = m.h; }
    if (x >= e.x && x <= e.x + w && y >= e.y && y <= e.y + h) return e;
  }
  return null;
}

// ---------- رسم الطبقة ----------
function fontString(e, scale) {
  const weight = e.bold ? "700" : "400";
  return `${weight} ${e.fontSize * scale}px "${e.fontFamily}", "Tajawal", Arial, sans-serif`;
}

function isArabic(t) {
  return /[؀-ۿݐ-ݿ]/.test(t || "");
}

function measureText(e) {
  // قياس بالنقاط (scale=1) باستخدام كانفس مؤقت
  const ctx = measureText._ctx || (measureText._ctx = document.createElement("canvas").getContext("2d"));
  ctx.font = fontString(e, 1);
  const lines = (e.text || "").split("\n");
  let maxW = 0;
  for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln || " ").width);
  const lineH = e.fontSize * 1.4;
  return { w: Math.max(maxW + 6, 20), h: Math.max(lines.length * lineH + 4, lineH) };
}

function drawOverlay(pageObj, forExport) {
  const cv = forExport
    ? forExport
    : pageObj.overlayCanvas;
  const scale = forExport ? forExport.__scale : state.RENDER_SCALE;
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);

  for (const e of pageObj.edits) {
    if (e.type === "rect") {
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x * scale, e.y * scale, e.w * scale, e.h * scale);
    } else if (e.type === "highlight") {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x * scale, e.y * scale, e.w * scale, e.h * scale);
      ctx.restore();
    } else if (e.type === "text") {
      drawTextEdit(ctx, e, scale);
    }
    // إطار التحديد (لا يُرسم في التصدير)
    if (!forExport && state.selected && state.selected.edit === e) {
      let w = e.w, h = e.h;
      if (e.type === "text") { const m = measureText(e); w = m.w; h = m.h; }
      ctx.save();
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(e.x * scale, e.y * scale, w * scale, h * scale);
      ctx.restore();
    }
  }
}

function drawTextEdit(ctx, e, scale) {
  ctx.save();
  ctx.font = fontString(e, scale);
  ctx.fillStyle = e.color;
  ctx.textBaseline = "top";
  const lines = (e.text || "").split("\n");
  const lineH = e.fontSize * 1.4 * scale;
  const rtl = isArabic(e.text);
  const m = measureText(e);
  if (rtl) {
    ctx.direction = "rtl";
    ctx.textAlign = "right";
    const rightX = (e.x + m.w - 3) * scale;
    lines.forEach((ln, i) => ctx.fillText(ln, rightX, e.y * scale + i * lineH + 2 * scale));
  } else {
    ctx.direction = "ltr";
    ctx.textAlign = "left";
    lines.forEach((ln, i) => ctx.fillText(ln, e.x * scale + 3 * scale, e.y * scale + i * lineH + 2 * scale));
  }
  ctx.restore();
}

// ---------- محرّر النص العائم ----------
function openInlineEditor(pageObj, edit, isNew) {
  const ta = document.createElement("textarea");
  ta.className = "floating-edit";
  ta.dir = "auto";
  const ds = pageObj.displayScale;
  const m = measureText(edit);
  ta.style.left = edit.x * ds + "px";
  ta.style.top = edit.y * ds + "px";
  ta.style.minWidth = Math.max(m.w, 120) * ds + "px";
  ta.style.minHeight = m.h * ds + "px";
  ta.style.font = `${edit.bold ? "700" : "400"} ${edit.fontSize * ds}px "${edit.fontFamily}", Arial, sans-serif`;
  ta.style.color = edit.color;
  ta.value = edit.text;
  pageObj.wrap.appendChild(ta);
  ta.focus();

  const commit = () => {
    edit.text = ta.value;
    if (isNew && !edit.text.trim()) {
      const i = pageObj.edits.indexOf(edit);
      if (i >= 0) pageObj.edits.splice(i, 1);
    }
    if (ta.parentNode) ta.parentNode.removeChild(ta);
    drawOverlay(pageObj);
  };
  ta.addEventListener("blur", commit);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { ta.blur(); }
    // Ctrl+Enter لإنهاء التحرير
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { ta.blur(); }
  });
  ta.addEventListener("input", () => {
    edit.text = ta.value;
    const mm = measureText(edit);
    ta.style.minWidth = Math.max(mm.w, 120) * ds + "px";
  });
}

// ---------- تحديد ----------
function selectEdit(pageIndex, edit) {
  state.selected = { pageIndex, edit };
  // حدّث شريط الخصائص بقيم العنصر
  if (edit.type === "text") {
    fontFamilySel.value = edit.fontFamily;
    fontSizeInp.value = edit.fontSize;
    textColorInp.value = edit.color;
    boldChk.checked = !!edit.bold;
    eraseColorWrap.classList.add("hidden");
  } else {
    eraseColorInp.value = edit.color;
    eraseColorWrap.classList.remove("hidden");
  }
  propsBar.classList.remove("hidden");
  state.pages.forEach(drawOverlayKeepSel);
}
function drawOverlayKeepSel(p) { drawOverlay(p); }

function clearSelection() {
  state.selected = null;
  const showProps = state.tool === "text" || state.tool === "erase" || state.tool === "highlight";
  propsBar.classList.toggle("hidden", !showProps);
  state.pages.forEach((p) => drawOverlay(p));
}

function deleteSelected() {
  if (!state.selected) return;
  pushUndo();
  const p = state.pages[state.selected.pageIndex];
  const i = p.edits.indexOf(state.selected.edit);
  if (i >= 0) p.edits.splice(i, 1);
  state.selected = null;
  drawOverlay(p);
}

document.addEventListener("keydown", (e) => {
  if ((e.key === "Delete" || e.key === "Backspace") && state.selected &&
      document.activeElement.tagName !== "TEXTAREA") {
    e.preventDefault();
    deleteSelected();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undo();
  }
});

// ---------- تراجع ----------
function pushUndo() {
  const snap = state.pages.map((p) => JSON.stringify(p.edits));
  state.undoStack.push(snap);
  if (state.undoStack.length > 50) state.undoStack.shift();
}
function undo() {
  const snap = state.undoStack.pop();
  if (!snap) return;
  state.pages.forEach((p, i) => { p.edits = JSON.parse(snap[i] || "[]"); });
  state.selected = null;
  state.pages.forEach((p) => drawOverlay(p));
  toast("تم التراجع");
}

// ---------- الحفظ كـ PDF ----------
async function savePdf() {
  const hasEdits = state.pages.some((p) => p.edits.length);
  showOverlay("جارٍ إنشاء ملف PDF…");
  try {
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.load(state.pdfBytes);
    const pages = pdfDoc.getPages();

    for (let i = 0; i < state.pages.length; i++) {
      const po = state.pages[i];
      if (!po.edits.length) continue;
      const page = pages[i];
      const { width, height } = page.getSize();

      // ارسم طبقة التعديلات على كانفس شفاف عالي الدقة
      const exp = document.createElement("canvas");
      const EXPORT_SCALE = 3;
      exp.width = Math.round(po.widthPt * EXPORT_SCALE);
      exp.height = Math.round(po.heightPt * EXPORT_SCALE);
      exp.__scale = EXPORT_SCALE;
      drawOverlay(po, exp);

      const pngUrl = exp.toDataURL("image/png");
      const png = await pdfDoc.embedPng(pngUrl);
      page.drawImage(png, { x: 0, y: 0, width, height });
    }

    const bytes = await pdfDoc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "معدّل.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(hasEdits ? "تم حفظ الملف المعدّل ✅" : "تم الحفظ (بدون تعديلات)");
  } catch (err) {
    alert("تعذّر الحفظ: " + (err && err.message ? err.message : err));
  } finally {
    hideOverlay();
  }
}

// ---------- أدوات واجهة ----------
function showOverlay(text) { overlayText.textContent = text; overlayMsg.classList.remove("hidden"); }
function hideOverlay() { overlayMsg.classList.add("hidden"); }
function toast(msg) {
  const t = document.createElement("div");
  t.className = "hint-toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

setTool("select");

