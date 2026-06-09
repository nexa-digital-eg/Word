@echo off
chcp 65001 >nul
title محول PDF الى Word - دعم العربية
cd /d "%~dp0\.."

REM --- التحقق من وجود البيئة الافتراضية ---
if not exist ".venv\Scripts\activate.bat" (
    echo [تنبيه] البرنامج غير مثبت بعد.
    echo شغّل ملف install.bat اولاً.
    echo.
    pause
    exit /b 1
)

call ".venv\Scripts\activate.bat"

REM --- فتح الواجهة الرسومية ---
python -m pdf_to_word.gui
if errorlevel 1 (
    echo.
    echo [خطأ] تعذّر فتح الواجهة. تأكد من اكتمال التثبيت.
    pause
)
