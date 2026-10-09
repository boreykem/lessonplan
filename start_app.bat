@echo off
title AI Lesson Plan Studio
cd /d "%~dp0"

echo ==========================================================
echo   Starting AI Lesson Plan Studio...
echo ==========================================================

:: 1. Try launching silently via WScript
start "" wscript.exe "%~dp0start_app.vbs"
if %errorlevel% equ 0 exit /b 0

:: 2. Fallback: Run silent_launcher.py directly via py
py "%~dp0silent_launcher.py"
if %errorlevel% equ 0 exit /b 0

:: 3. Fallback: Run silent_launcher.py directly via python
python "%~dp0silent_launcher.py"
if %errorlevel% equ 0 exit /b 0

:: 4. Direct Server Fallback
start http://127.0.0.1:8765
py "%~dp0server.py"
if %errorlevel% neq 0 (
    python "%~dp0server.py"
)

pause
