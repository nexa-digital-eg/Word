"""يسمح بتشغيل الحزمة عبر:  python -m pdf_to_word ..."""

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
