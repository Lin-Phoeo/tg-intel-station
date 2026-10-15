import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToastScript } from '../app/server/notify.mjs';

function xmlFrom(script) {
  const match = script.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/);
  assert.ok(match, '通知 XML 必须独立编码');
  return Buffer.from(match[1], 'base64').toString('utf8');
}

test('通知 XML：正确转义、保留 Unicode、折叠换行', () => {
  const ps = buildToastScript('标题<&>"', "正文 <b> & ' 引号\n下一行");
  const xml = xmlFrom(ps);
  assert.ok(xml.includes('&lt;') && xml.includes('&amp;') && xml.includes('&quot;'));
  assert.ok(xml.includes("' 引号 下一行"));
  assert.ok(ps.includes('TgIntelStation.Briefing'));
  assert.ok(ps.includes('DisplayName'));
});

test('通知 XML：超长文本被截断', () => {
  const xml = xmlFrom(buildToastScript('t', 'x'.repeat(500)));
  assert.ok(!xml.includes('x'.repeat(241)));
});

test('通知正文作为编码数据传递，智能引号不能进入脚本', () => {
  const body = '正文’); Write-Output REVIEW_SENTINEL; #';
  const ps = buildToastScript('标题', body);
  assert.ok(!ps.includes('REVIEW_SENTINEL'));
  assert.ok(xmlFrom(ps).includes(body));
  assert.ok(ps.includes('$doc.LoadXml($xml)'));
});
