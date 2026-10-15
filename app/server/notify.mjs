// Windows 桌面通知：借系统自带 PowerShell 调 Windows Runtime Toast API，零依赖。
// 只做一件事：尽力弹一条通知；任何失败都只记日志、不抛错，绝不阻断调用方。
import { execFile } from 'node:child_process';

const AUMID = 'TgIntelStation.Briefing';   // 注册后通知来源显示为「电报情报站」

function escXml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// XML 单独编码成数据，避免 PowerShell 把正文中的智能引号当作代码边界。
export function buildToastScript(title, body) {
  const t = escXml(String(title).replace(/[\r\n]+/g, ' ').slice(0, 120));
  const b = escXml(String(body).replace(/[\r\n]+/g, ' ').slice(0, 240));
  const xml = '<toast><visual><binding template="ToastGeneric"><text>' + t + '</text><text>' + b + '</text></binding></visual></toast>';
  return [
    "$ErrorActionPreference = 'Stop'",
    "$aumid = '" + AUMID + "'",
    "$key = 'HKCU:\\SOFTWARE\\Classes\\AppUserModelId\\' + $aumid",
    "if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null; New-ItemProperty -Path $key -Name 'DisplayName' -Value '电报情报站' -PropertyType String -Force | Out-Null }",
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '$doc = New-Object Windows.Data.Xml.Dom.XmlDocument',
    "$xml = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('" + Buffer.from(xml, 'utf8').toString('base64') + "'))",
    '$doc.LoadXml($xml)',
    '$toast = New-Object Windows.UI.Notifications.ToastNotification $doc',
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid).Show($toast)',
  ].join('\n');
}

export function toast(title, body) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    try {
      const b64 = Buffer.from(buildToastScript(title, body), 'utf16le').toString('base64');
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
        { timeout: 10000, windowsHide: true },
        (err) => { if (err) console.error('[notify] toast 失败：', err.message); resolve(!err); });
    } catch (e) { console.error('[notify] toast 异常：', String(e && e.message || e)); resolve(false); }
  });
}
