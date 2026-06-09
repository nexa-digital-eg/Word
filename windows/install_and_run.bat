@echo off
chcp 65001 >nul
title محول PDF الى Word - تثبيت وتشغيل
cd /d "%~dp0\.."

echo ============================================
echo   محول PDF الى Word - دعم العربية
echo ============================================
echo.

REM --- التحقق من وجود بايثون ---
where python >nul 2>&1
if errorlevel 1 (
    echo [خطأ] بايثون غير مثبت او غير مضاف الى PATH.
    echo حمّله من https://www.python.org/downloads/
    echo وفعّل خيار "Add Python to PATH" اثناء التثبيت.
    echo.
    pause
    exit /b 1
)

REM --- التثبيت لاول مرة فقط ---
if not exist ".venv\Scripts\activate.bat" (
    echo [اول مرة] جاري تثبيت البرنامج... قد ياخذ دقيقة او اثنتين.
    python -m venv .venv
    call ".venv\Scripts\activate.bat"
    python -m pip install --upgrade pip >nul
    pip install -e .
    if errorlevel 1 (
        echo [خطأ] فشل تثبيت المكتبات. تاكد من اتصال الانترنت.
        pause
        exit /b 1
    )
    echo تم التثبيت بنجاح.
) else (
    call ".venv\Scripts\activate.bat"
)

echo.
echo جاري فتح البرنامج...
python -m pdf_to_word.gui
if errorlevel 1 (
    echo.
    echo [خطأ] تعذّر فتح الواجهة.
    pause
)
