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
  echo   [提示] 未找到检索索引。请先运行一次：
  echo          node scrape\scrape.mjs
  echo          node scrape\build.mjs
  echo          node app\server\build-db.mjs
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
start "" /b cmd /c "timeout /t 3 >nul & start "" http://127.0.0.1:8317"
node app\server\index.mjs
pause
