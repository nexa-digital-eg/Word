@echo off
chcp 65001 >nul
title تثبيت محول PDF الى Word
cd /d "%~dp0\.."

echo ============================================
echo   تثبيت محول PDF الى Word - دعم العربية
echo ============================================
echo.

REM --- التحقق من وجود بايثون ---
where python >nul 2>&1
if errorlevel 1 (
    echo [خطأ] بايثون غير مثبت على الجهاز.
    echo حمّله من: https://www.python.org/downloads/
    echo مهم: فعّل خيار "Add Python to PATH" اثناء التثبيت.
    echo.
    pause
    exit /b 1
)

echo [1/3] انشاء بيئة افتراضية...
if not exist ".venv" (
    python -m venv .venv
)

echo [2/3] تفعيل البيئة وترقية pip...
call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip >nul

echo [3/3] تثبيت المكتبات والبرنامج...
pip install -e .
if errorlevel 1 (
    echo [خطأ] فشل تثبيت المكتبات.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   تم التثبيت بنجاح!
echo ============================================
echo.
echo تنبيه مهم لتحويل العربية بدقة (محرك OCR):
echo   حمّل Tesseract من:
echo   https://github.com/UB-Mannheim/tesseract/wiki
echo   واختر اللغة العربية (Arabic) اثناء التثبيت،
echo   ثم اعد تشغيل الجهاز.
echo.
echo لتشغيل البرنامج: شغّل ملف run.bat بنقرة مزدوجة.
echo.
pause
