@echo off
title Deploy Lesson Plan App to GitHub
cd /d "%~dp0"
echo ==========================================================
echo   Deploying Lesson Plan to GitHub (boreykem/lessonplan)...
echo ==========================================================
echo.
git status
echo.
echo Pushing local commits to GitHub main branch...
git push origin main
if %errorlevel% equ 0 (
    echo.
    echo ==========================================================
    echo   [SUCCESS] Deployed successfully to GitHub!
    echo   Repository: https://github.com/boreykem/lessonplan
    echo ==========================================================
) else (
    echo.
    echo ==========================================================
    echo   [ERROR] Git push encountered an issue.
    echo   Please check your GitHub login or Internet connection.
    echo ==========================================================
)
echo.
pause
