@echo off
chcp 65001 >nul
title تحويل PDF الى Word
cd /d "%~dp0\.."

if not exist ".venv\Scripts\activate.bat" (
    echo [تنبيه] شغّل install.bat اولاً.
    pause
    exit /b 1
)

call ".venv\Scripts\activate.bat"

if "%~1"=="" (
    echo اسحب ملف PDF واحد او اكثر وافلته على هذا الملف لتحويله.
    echo او شغّل الواجهة الرسومية عبر run.bat
    echo.
    pause
    exit /b 0
)

REM --- تحويل كل ملف تم افلاته ---
:loop
if "%~1"=="" goto done
echo.
echo ====== تحويل: %~nx1 ======
python -m pdf_to_word "%~1" --engine auto
shift
goto loop

:done
echo.
echo تم الانتهاء. ملفات الوورد بجوار ملفات الـ PDF الاصلية.
pause
