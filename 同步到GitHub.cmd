@echo off
chcp 65001 >nul
title 同步到 GitHub
cd /d "%~dp0"
echo.
echo   正在尝试推送到 GitHub ...
echo   如果一直失败，说明代理（127.0.0.1:7890）当前不可用，
echo   请在代理软件里换一个节点后重新双击本文件。
echo.

set /a n=0
:loop
set /a n+=1
if %n% GTR 12 goto giveup
echo [第 %n% 次尝试]
git push origin main
if %errorlevel%==0 goto ok
timeout /t 10 >nul
goto loop

:ok
echo.
echo   ============================================
echo    推送成功！https://github.com/Lin-Phoeo/tg-intel-station
echo   ============================================
pause
exit /b 0

:giveup
echo.
echo   多次尝试仍失败。请确认代理可用后重试，或手动执行： git push origin main
pause
exit /b 1
