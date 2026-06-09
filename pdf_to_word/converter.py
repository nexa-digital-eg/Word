"""المحرّك الأساسي لتحويل PDF إلى Word مع دعم العربية.

Core engine that converts PDF files to Word (.docx) while keeping Arabic
text intact regardless of the font used in the original PDF.

Three engines are available:

* ``ocr``  : يعيد قراءة الصفحة كصورة عبر Tesseract. الأكثر موثوقية للعربية
             لأنه لا يعتمد على ترميز النص داخل الـ PDF، فلا يتعرض النص للتلف
             أو الانعكاس مهما كان نوع الخط. (الأبطأ)
* ``text`` : يستخرج طبقة النص مباشرة من الـ PDF. الأسرع، ومناسب للملفات
             التي تحتوي على نص حقيقي قابل للنسخ.
* ``auto`` : (الافتراضي) يختار لكل صفحة الطريقة الأنسب: يستخرج النص إن وُجد
             نص سليم، وإلا يلجأ إلى الـ OCR. توازن بين السرعة والموثوقية.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, List, Optional

import fitz  # PyMuPDF
import pytesseract
from PIL import Image

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt
from docx.oxml import OxmlElement

# نطاقات يونيكود للأحرف العربية (بما فيها الأشكال التقديمية).
_ARABIC_RANGES = (
    (0x0600, 0x06FF),  # Arabic
    (0x0750, 0x077F),  # Arabic Supplement
    (0x08A0, 0x08FF),  # Arabic Extended-A
    (0xFB50, 0xFDFF),  # Arabic Presentation Forms-A
    (0xFE70, 0xFEFF),  # Arabic Presentation Forms-B
)

ProgressCallback = Callable[[int, int, str], None]


def _is_arabic_char(ch: str) -> bool:
    code = ord(ch)
    return any(start <= code <= end for start, end in _ARABIC_RANGES)


def contains_arabic(text: str) -> bool:
    """هل يحتوي النص على أي حرف عربي؟"""
    return any(_is_arabic_char(ch) for ch in text)


# المحارف غير المسموح بها في XML 1.0 (وبالتالي في ملفات docx).
# يُسمح بالتبويب والسطر الجديد فقط من محارف التحكم؛ الباقي يُزال.
_VALID_XML_RANGES = (
    "\t\n\r"
    "\u0020-\ud7ff"
    "\ue000-\ufffd"
    "\U00010000-\U0010ffff"
)
_INVALID_XML = re.compile(f"[^{_VALID_XML_RANGES}]")


def sanitize_xml_text(text: str) -> str:
    """يزيل المحارف التحكمية/الصفرية التي تُفسد ملف الوورد."""
    if not text:
        return ""
    return _INVALID_XML.sub("", text)


def _has_presentation_forms(text: str) -> bool:
    """يكتشف الأشكال التقديمية العربية (FB50–FDFF, FE70–FEFF).

    وجودها في طبقة النص دليل قوي على أن النص مخزّن بترتيب بصري/تالف،
    وهو ما يُفسد النتيجة عند الاستخراج المباشر؛ لذا يُفضَّل اللجوء للـ OCR.
    """
    for ch in text:
        code = ord(ch)
        if 0xFB50 <= code <= 0xFDFF or 0xFE70 <= code <= 0xFEFF:
            return True
    return False


def _arabic_ratio(text: str) -> float:
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return 0.0
    arabic = sum(1 for ch in letters if _is_arabic_char(ch))
    return arabic / len(letters)


@dataclass
class ConversionOptions:
    """خيارات التحويل."""

    engine: str = "auto"           # auto | ocr | text
    languages: str = "ara+eng"     # لغات الـ OCR
    dpi: int = 300                 # دقة عرض الصفحة عند الـ OCR
    default_font: str = "Arial"    # خط مناسب للعربية في ملف الوورد
    font_size: int = 12            # حجم الخط (نقطة)
    # الحد الأدنى لعدد المحارف في طبقة النص حتى تُعتبر الصفحة "نصية" في وضع auto
    min_text_chars: int = 12

    def __post_init__(self) -> None:
        self.engine = self.engine.lower().strip()
        if self.engine not in {"auto", "ocr", "text"}:
            raise ValueError(
                f"محرك غير معروف: {self.engine!r} (المتاح: auto, ocr, text)"
            )
        if self.dpi < 72:
            raise ValueError("الدقة (dpi) يجب ألا تقل عن 72")


@dataclass
class ConversionResult:
    """نتيجة التحويل."""

    output_path: Path
    page_count: int
    pages_ocr: int = 0
    pages_text: int = 0
    has_arabic: bool = False
    warnings: List[str] = field(default_factory=list)


class PdfToWordConverter:
    """يحوّل ملف PDF واحد إلى مستند Word (.docx)."""

    def __init__(self, options: Optional[ConversionOptions] = None) -> None:
        self.options = options or ConversionOptions()
        self._verify_tesseract_if_needed()

    # ------------------------------------------------------------------ #
    # واجهة عامة
    # ------------------------------------------------------------------ #
    def convert(
        self,
        pdf_path: str | Path,
        output_path: str | Path | None = None,
        progress: Optional[ProgressCallback] = None,
    ) -> ConversionResult:
        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            raise FileNotFoundError(f"لم يتم العثور على الملف: {pdf_path}")
        if pdf_path.suffix.lower() != ".pdf":
            raise ValueError("الملف المدخل يجب أن يكون بصيغة PDF")

        if output_path is None:
            output_path = pdf_path.with_suffix(".docx")
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        document = self._new_document()
        result = ConversionResult(output_path=output_path, page_count=0)

        with fitz.open(pdf_path) as pdf:
            result.page_count = pdf.page_count
            for index, page in enumerate(pdf):
                if progress:
                    progress(index + 1, pdf.page_count, f"الصفحة {index + 1}")

                text, used_ocr = self._extract_page_text(page)
                if used_ocr:
                    result.pages_ocr += 1
                else:
                    result.pages_text += 1

                if contains_arabic(text):
                    result.has_arabic = True

                self._write_page(document, text)

                if index < pdf.page_count - 1:
                    document.add_page_break()

        document.save(str(output_path))
        return result

    # ------------------------------------------------------------------ #
    # استخراج النص
    # ------------------------------------------------------------------ #
    def _extract_page_text(self, page: "fitz.Page") -> tuple[str, bool]:
        """يرجع (النص، هل_استُخدم_OCR)."""
        engine = self.options.engine

        if engine == "text":
            return self._page_text_layer(page), False

        if engine == "ocr":
            return self._page_ocr(page), True

        # auto: استخدم طبقة النص إن كانت كافية وسليمة، وإلا OCR.
        layer = self._page_text_layer(page)
        if len(layer.strip()) < self.options.min_text_chars:
            # لا توجد طبقة نص مفيدة (صفحة ممسوحة ضوئياً) → OCR.
            return self._page_ocr(page), True
        if _has_presentation_forms(layer):
            # طبقة النص تحتوي أشكالاً تقديمية للعربية (غالباً مقلوبة/تالفة)
            # وهي السبب الشائع لتلف النص → الأفضل اللجوء إلى OCR.
            return self._page_ocr(page), True
        return layer, False

    def _page_text_layer(self, page: "fitz.Page") -> str:
        # "text" يحافظ على الترتيب المنطقي للأحرف؛ يتولى Word تشكيل العربية.
        return page.get_text("text")

    def _page_ocr(self, page: "fitz.Page") -> str:
        zoom = self.options.dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        pixmap = page.get_pixmap(matrix=matrix, alpha=False)
        image = Image.open(io.BytesIO(pixmap.tobytes("png")))
        # psm 1: تقسيم تلقائي للصفحة مع كشف اتجاه/نص.
        config = "--oem 1 --psm 1"
        text = pytesseract.image_to_string(
            image, lang=self.options.languages, config=config
        )
        return text

    # ------------------------------------------------------------------ #
    # كتابة مستند Word
    # ------------------------------------------------------------------ #
    def _new_document(self) -> "Document":
        document = Document()
        style = document.styles["Normal"]
        style.font.name = self.options.default_font
        style.font.size = Pt(self.options.font_size)
        # اضبط الخط لكل من النص اللاتيني والنص المعقّد (العربية).
        rpr = style.element.get_or_add_rPr()
        rfonts = rpr.find(qn("w:rFonts"))
        if rfonts is None:
            rfonts = OxmlElement("w:rFonts")
            rpr.append(rfonts)
        rfonts.set(qn("w:ascii"), self.options.default_font)
        rfonts.set(qn("w:hAnsi"), self.options.default_font)
        rfonts.set(qn("w:cs"), self.options.default_font)  # complex script
        return document

    def _write_page(self, document: "Document", text: str) -> None:
        # نظّف المحارف غير الصالحة حتى لا يتعطّل حفظ الملف.
        text = sanitize_xml_text(text)
        # حافظ على فقرات النص؛ كل سطر فارغ مزدوج يبدأ فقرة جديدة.
        blocks = re.split(r"\n", text)
        if not any(block.strip() for block in blocks):
            document.add_paragraph("")
            return

        for line in blocks:
            paragraph = document.add_paragraph()
            run = paragraph.add_run(line)
            self._apply_size(run)
            if contains_arabic(line) or _arabic_ratio(line) > 0:
                self._make_rtl(paragraph, run)
            else:
                paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT

    def _apply_size(self, run) -> None:
        run.font.size = Pt(self.options.font_size)
        run.font.name = self.options.default_font
        rpr = run._element.get_or_add_rPr()
        rfonts = rpr.find(qn("w:rFonts"))
        if rfonts is None:
            rfonts = OxmlElement("w:rFonts")
            rpr.append(rfonts)
        rfonts.set(qn("w:cs"), self.options.default_font)

    def _make_rtl(self, paragraph, run) -> None:
        """يضبط الفقرة والتشغيلة على الاتجاه من اليمين لليسار."""
        paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT

        p_pr = paragraph._p.get_or_add_pPr()
        bidi = p_pr.find(qn("w:bidi"))
        if bidi is None:
            bidi = OxmlElement("w:bidi")
            p_pr.append(bidi)
        bidi.set(qn("w:val"), "1")

        r_pr = run._element.get_or_add_rPr()
        rtl = r_pr.find(qn("w:rtl"))
        if rtl is None:
            rtl = OxmlElement("w:rtl")
            r_pr.append(rtl)
        rtl.set(qn("w:val"), "1")

    # ------------------------------------------------------------------ #
    # أدوات مساعدة
    # ------------------------------------------------------------------ #
    def _verify_tesseract_if_needed(self) -> None:
        if self.options.engine == "text":
            return
        try:
            pytesseract.get_tesseract_version()
        except Exception as exc:  # pragma: no cover - بيئة بدون tesseract
            raise RuntimeError(
                "محرك OCR (Tesseract) غير مثبّت أو غير موجود في PATH.\n"
                "ثبّته أولاً:\n"
                "  Ubuntu/Debian: sudo apt-get install tesseract-ocr "
                "tesseract-ocr-ara\n"
                "  Windows: حمّل من https://github.com/UB-Mannheim/tesseract/wiki\n"
                "أو استخدم المحرك 'text' الذي لا يحتاج OCR."
            ) from exc
