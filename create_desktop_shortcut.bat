@echo off
chcp 65001 >nul
title បង្កើត Shortcut លើ Desktop

echo ==========================================================
echo   កំពុងបង្កើត Shortcut លើ Desktop របស់អ្នក...
echo ==========================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create_shortcut.ps1"

if %errorlevel% equ 0 (
    echo.
    echo ✅ បានបង្កើត Shortcut "AI Lesson Plan Studio" លើ Desktop របស់អ្នកដោយជោគជ័យ!
    echo លោកអ្នកអាចចុចពីរដង (Double-Click) លើ Icon នៅលើ Desktop ដើម្បីបើកកម្មវិធីបានភ្លាមៗ។
) else (
    echo ⚠️ មានបញ្ហាក្នុងការបង្កើត Shortcut សូមចុចលើ start_app.bat ផ្ទាល់។
)

echo.
pause
