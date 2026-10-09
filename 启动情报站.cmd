@echo off
chcp 65001 >nul
title 电报情报站
cd /d "%~dp0"

if not exist "app\web\dist\index.html" (
  echo.
  echo   首次运行，正在安装前端依赖并构建界面，请稍候...
  echo.
  pushd app\web
  call npm install
  call npm run build
  popd
  if not exist "app\web\dist\index.html" (
    echo.
    echo   [失败] 前端构建未完成，请确认已安装 Node.js 后重试。
    pause
    exit /b 1
  )
)

if not exist "app\data\intel.db" (
  echo.
  echo   [提示] 未找到检索索引，请先运行一次：
  echo          npm run fetch
  echo          npm run index:build
  echo.
  pause
)

echo.
echo   ============================================
echo    电报情报站  Telegram Intel Station
echo   ============================================
echo.
echo   正在启动本地服务，稍后会自动打开浏览器...
echo   关闭此窗口即可停止服务。
echo.

:loop
start "" /b cmd /c "timeout /t 3 >nul & start "" http://127.0.0.1:8317"
node app\server\index.mjs
set CODE=%ERRORLEVEL%

rem 从备份恢复后服务会主动退出，这里负责用新数据把它拉起来
if exist "app\data\.restart" (
  del "app\data\.restart" >nul 2>&1
  echo.
  echo   [已恢复备份] 正在重启服务...
  echo.
  timeout /t 1 /nobreak >nul
  goto loop
)

if not "%CODE%"=="0" (
  echo.
  echo   服务异常退出（退出码 %CODE%）。把上面的报错信息留好，可据此排查。
  echo.
  pause
  exit /b %CODE%
)

echo.
echo   服务已停止。
pause
