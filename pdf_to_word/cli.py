"""واجهة سطر الأوامر لمحول PDF إلى Word.

أمثلة:
    python -m pdf_to_word file.pdf
    python -m pdf_to_word file.pdf -o out.docx --engine ocr
    python -m pdf_to_word *.pdf --engine auto --dpi 400
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .converter import ConversionOptions, PdfToWordConverter


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pdf_to_word",
        description="محول PDF إلى Word مع دعم كامل للعربية بجميع الخطوط.",
    )
    parser.add_argument("inputs", nargs="+", help="ملف/ملفات PDF للتحويل")
    parser.add_argument(
        "-o", "--output",
        help="مسار ملف الإخراج (لملف واحد فقط)؛ افتراضياً بجوار الملف الأصلي.",
    )
    parser.add_argument(
        "--engine", choices=["auto", "ocr", "text"], default="auto",
        help="محرك التحويل (الافتراضي: auto). استخدم ocr لأقصى دقة للعربية.",
    )
    parser.add_argument(
        "--lang", default="ara+eng",
        help="لغات الـ OCR مفصولة بـ + (الافتراضي: ara+eng).",
    )
    parser.add_argument(
        "--dpi", type=int, default=300,
        help="دقة عرض الصفحة عند الـ OCR (الافتراضي: 300).",
    )
    parser.add_argument(
        "--font", default="Arial",
        help="خط مستند الوورد (الافتراضي: Arial).",
    )
    parser.add_argument(
        "--font-size", type=int, default=12,
        help="حجم الخط بالنقطة (الافتراضي: 12).",
    )
    return parser


def _progress(current: int, total: int, label: str) -> None:
    bar_len = 30
    filled = int(bar_len * current / total) if total else bar_len
    bar = "█" * filled + "─" * (bar_len - filled)
    print(f"\r  [{bar}] {current}/{total} {label}", end="", flush=True)
    if current == total:
        print()


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    inputs = [Path(p) for p in args.inputs]
    if args.output and len(inputs) > 1:
        print("خطأ: لا يمكن استخدام --output مع أكثر من ملف.", file=sys.stderr)
        return 2

    options = ConversionOptions(
        engine=args.engine,
        languages=args.lang,
        dpi=args.dpi,
        default_font=args.font,
        font_size=args.font_size,
    )

    try:
        converter = PdfToWordConverter(options)
    except RuntimeError as exc:
        print(f"خطأ: {exc}", file=sys.stderr)
        return 1

    exit_code = 0
    for pdf_path in inputs:
        output = Path(args.output) if args.output else None
        print(f"\n▶ تحويل: {pdf_path}")
        try:
            result = converter.convert(pdf_path, output, progress=_progress)
        except Exception as exc:  # noqa: BLE001
            print(f"  ✗ فشل: {exc}", file=sys.stderr)
            exit_code = 1
            continue

        print(f"  ✓ تم الحفظ في: {result.output_path}")
        print(
            f"    الصفحات: {result.page_count} "
            f"(OCR: {result.pages_ocr} | نص: {result.pages_text}) "
            f"| عربي: {'نعم' if result.has_arabic else 'لا'}"
        )
        for warning in result.warnings:
            print(f"    ⚠ {warning}")

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
