"""اختبارات أساسية للمحوّل.

تتطلب بعض الاختبارات تثبيت Tesseract + اللغة العربية؛ وتُتخطّى تلقائياً
إن لم يكن متاحاً.
"""

import shutil
from pathlib import Path

import pytest

from pdf_to_word.converter import (
    ConversionOptions,
    PdfToWordConverter,
    contains_arabic,
    sanitize_xml_text,
    _has_presentation_forms,
)

SAMPLE = Path(__file__).resolve().parents[1] / "samples" / "test_arabic.pdf"
HAS_TESSERACT = shutil.which("tesseract") is not None


def test_contains_arabic():
    assert contains_arabic("مرحبا")
    assert contains_arabic("hello مرحبا")
    assert not contains_arabic("hello world 123")


def test_sanitize_removes_control_chars():
    dirty = "نص\x00سليم\x07هنا"
    clean = sanitize_xml_text(dirty)
    assert "\x00" not in clean and "\x07" not in clean
    assert "نص" in clean and "سليم" in clean


def test_detects_presentation_forms():
    # FEFB = شكل تقديمي لـ "لا"
    assert _has_presentation_forms("ﻻ")
    assert not _has_presentation_forms("نص عادي")


def test_invalid_engine_rejected():
    with pytest.raises(ValueError):
        ConversionOptions(engine="magic")


def test_missing_file():
    conv = PdfToWordConverter(ConversionOptions(engine="text"))
    with pytest.raises(FileNotFoundError):
        conv.convert("/no/such/file.pdf")


@pytest.mark.skipif(not SAMPLE.exists(), reason="ملف العينة غير موجود")
def test_text_engine_produces_docx(tmp_path):
    conv = PdfToWordConverter(ConversionOptions(engine="text"))
    out = tmp_path / "out.docx"
    result = conv.convert(SAMPLE, out)
    assert out.exists()
    assert result.page_count >= 1


@pytest.mark.skipif(
    not (SAMPLE.exists() and HAS_TESSERACT),
    reason="يتطلب Tesseract وملف العينة",
)
def test_ocr_engine_keeps_arabic(tmp_path):
    from docx import Document

    conv = PdfToWordConverter(ConversionOptions(engine="ocr"))
    out = tmp_path / "out.docx"
    conv.convert(SAMPLE, out)
    text = "\n".join(p.text for p in Document(str(out)).paragraphs)
    # يجب أن يظهر نص عربي سليم بالترتيب المنطقي.
    assert "الرحمن" in text
    assert contains_arabic(text)
