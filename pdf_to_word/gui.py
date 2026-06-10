"""واجهة رسومية بسيطة (Tkinter) لمحول PDF إلى Word.

التشغيل:
    python -m pdf_to_word.gui
"""

from __future__ import annotations

import threading
from pathlib import Path

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "Tkinter غير متوفر في هذه البيئة. استخدم واجهة سطر الأوامر بدلاً منها:\n"
        "  python -m pdf_to_word file.pdf"
    ) from exc

from .converter import ConversionOptions, PdfToWordConverter


class ConverterApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        root.title("محول PDF إلى Word - دعم العربية")
        root.geometry("560x420")
        root.minsize(520, 400)

        self.files: list[Path] = []

        main = ttk.Frame(root, padding=16)
        main.pack(fill="both", expand=True)

        title = ttk.Label(
            main, text="محوّل ملفات PDF إلى Word",
            font=("Arial", 16, "bold"),
        )
        title.pack(pady=(0, 4))
        ttk.Label(
            main, text="دعم كامل للغة العربية بجميع أنواع الخطوط",
            font=("Arial", 10),
        ).pack(pady=(0, 12))

        # اختيار الملفات
        ttk.Button(main, text="📂 اختر ملفات PDF", command=self._pick_files).pack()
        self.files_label = ttk.Label(main, text="لم يتم اختيار ملفات بعد")
        self.files_label.pack(pady=(6, 12))

        # الخيارات
        opts = ttk.LabelFrame(main, text="الإعدادات", padding=10)
        opts.pack(fill="x", pady=(0, 12))

        ttk.Label(opts, text="المحرّك:").grid(row=0, column=0, sticky="w", padx=4)
        self.engine = tk.StringVar(value="auto")
        ttk.Combobox(
            opts, textvariable=self.engine, state="readonly", width=10,
            values=["auto", "ocr", "text"],
        ).grid(row=0, column=1, sticky="w", padx=4)
        ttk.Label(
            opts, text="auto: ذكي • ocr: أدق للعربية • text: الأسرع",
            font=("Arial", 8),
        ).grid(row=0, column=2, sticky="w", padx=4)

        ttk.Label(opts, text="اللغات:").grid(row=1, column=0, sticky="w", padx=4)
        self.lang = tk.StringVar(value="ara+eng")
        ttk.Entry(opts, textvariable=self.lang, width=12).grid(
            row=1, column=1, sticky="w", padx=4, pady=4
        )

        ttk.Label(opts, text="الدقة (DPI):").grid(row=2, column=0, sticky="w", padx=4)
        self.dpi = tk.IntVar(value=300)
        ttk.Spinbox(
            opts, from_=72, to=600, increment=50, textvariable=self.dpi, width=10
        ).grid(row=2, column=1, sticky="w", padx=4)

        # زر التحويل
        self.convert_btn = ttk.Button(
            main, text="🔄 ابدأ التحويل", command=self._start
        )
        self.convert_btn.pack(pady=(0, 10))

        self.progress = ttk.Progressbar(main, mode="determinate")
        self.progress.pack(fill="x")
        self.status = ttk.Label(main, text="جاهز")
        self.status.pack(pady=(6, 0))

    # ------------------------------------------------------------------ #
    def _pick_files(self) -> None:
        paths = filedialog.askopenfilenames(
            title="اختر ملفات PDF",
            filetypes=[("ملفات PDF", "*.pdf"), ("كل الملفات", "*.*")],
        )
        if paths:
            self.files = [Path(p) for p in paths]
            self.files_label.config(text=f"تم اختيار {len(self.files)} ملف")

    def _start(self) -> None:
        if not self.files:
            messagebox.showwarning("تنبيه", "اختر ملف PDF واحد على الأقل.")
            return
        self.convert_btn.config(state="disabled")
        thread = threading.Thread(target=self._run, daemon=True)
        thread.start()

    def _run(self) -> None:
        try:
            options = ConversionOptions(
                engine=self.engine.get(),
                languages=self.lang.get(),
                dpi=self.dpi.get(),
            )
            converter = PdfToWordConverter(options)
        except Exception as exc:  # noqa: BLE001
            self._set_status(f"خطأ: {exc}")
            messagebox.showerror("خطأ", str(exc))
            self.root.after(0, lambda: self.convert_btn.config(state="normal"))
            return

        done = 0
        for pdf in self.files:
            self._set_status(f"جارٍ تحويل: {pdf.name}")

            def progress(cur: int, total: int, _label: str) -> None:
                self.root.after(
                    0, lambda: self.progress.configure(
                        maximum=total, value=cur
                    )
                )

            try:
                result = converter.convert(pdf, progress=progress)
                done += 1
                self._set_status(f"تم: {result.output_path.name}")
            except Exception as exc:  # noqa: BLE001
                self._set_status(f"فشل {pdf.name}: {exc}")
                messagebox.showerror("خطأ", f"{pdf.name}\n{exc}")

        self.root.after(0, lambda: self.convert_btn.config(state="normal"))
        if done:
            messagebox.showinfo("اكتمل", f"تم تحويل {done} ملف بنجاح.")

    def _set_status(self, text: str) -> None:
        self.root.after(0, lambda: self.status.config(text=text))


def main() -> None:
    root = tk.Tk()
    ConverterApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
