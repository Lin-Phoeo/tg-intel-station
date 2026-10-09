@echo off
chcp 65001 >nul
cd /d "%~dp0"
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
if not exist "%STARTUP%" mkdir "%STARTUP%"

if /i "%~1"=="remove" (
  del "%STARTUP%\电报情报站.lnk" >nul 2>&1
  echo.
  echo   已取消开机自启。
  echo.
  pause
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\电报情报站.lnk');" ^
  "$s.TargetPath = '%~dp0启动情报站.cmd';" ^
  "$s.WorkingDirectory = '%~dp0';" ^
  "$s.WindowStyle = 7;" ^
  "$s.Description = '电报情报站';" ^
  "$s.Save()"

if exist "%STARTUP%\电报情报站.lnk" (
  echo.
  echo   已设置开机自启（最小化窗口启动）。
  echo   取消请运行：  开机自启.cmd remove
  echo.
) else (
  echo.
  echo   [失败] 未能创建快捷方式，请手动把「启动情报站.cmd」放进：
  echo          %STARTUP%
  echo.
)
pause
