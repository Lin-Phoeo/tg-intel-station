import { useEffect, useRef, useState } from 'react';
import { getBot, saveBot, testBot, previewBot, pushBot, stopBot, getBotStatus } from '../api';

type Cfg = {
  enabled: boolean; hasToken: boolean; tokenHint: string; pushChatId: string; allowedChatIds: string;
  autoPush: boolean; pushHour: number; pushMinValue: number; pushTags: string[]; pushLimit: number;
  windowDays: number; allowAsk: boolean; lastPushDate: string; pushedCount: number;
  ingestGroups: boolean; ingestedCount: number; lastIngest: any;
};
const TAGS = ['免费', '限时', '开源', '教程', '节点', '账号', '需注册', '破解'];

export function BotSettings() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [status, setStatus] = useState<any>({});
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [preview, setPreview] = useState<{ html: string; count: number } | null>(null);
  const timer = useRef<any>(null);

  async function refresh() {
    const r = await getBot();
    setCfg(r.config);
    setStatus(r.status || {});
  }
  useEffect(() => {
    refresh();
    timer.current = setInterval(async () => {
      try { const r = await getBotStatus(); setStatus(r.status || {}); setCfg(r.config); } catch (e) {}
    }, 8000);
    return () => clearInterval(timer.current);
  }, []);

  if (!cfg) return <div style={{ padding: 20, color: 'var(--fg-mute)' }}>加载中…</div>;
  const upd = (k: keyof Cfg, v: any) => setCfg(c => (c ? { ...c, [k]: v } : c));

  async function doSave(restart: boolean) {
    setBusy(true);
    const payload: any = {
      enabled: cfg.enabled, pushChatId: cfg.pushChatId, allowedChatIds: cfg.allowedChatIds,
      autoPush: cfg.autoPush, pushHour: Number(cfg.pushHour), pushMinValue: Number(cfg.pushMinValue),
      pushTags: cfg.pushTags, pushLimit: Number(cfg.pushLimit), windowDays: Number(cfg.windowDays),
      allowAsk: cfg.allowAsk, ingestGroups: cfg.ingestGroups, restart: restart,
    };
    if (token.trim()) payload.token = token.trim();
    const r = await saveBot(payload);
    setCfg(r.config); setStatus(r.status || {});
    setToken(''); setBusy(false);
    setMsg({ kind: 'ok', text: restart ? '已保存并重启机器人' : '已保存' });
  }

  async function doTest() {
    setBusy(true);
    setMsg({ kind: 'info', text: '正在校验 Token…' });
    const r = await testBot(token.trim() || undefined);
    setBusy(false);
    if (r.ok) setMsg({ kind: 'ok', text: '连接成功：@' + r.me.username + '（' + r.me.name + '）' });
    else setMsg({ kind: 'err', text: r.error || '失败' });
  }

  async function doPreview() {
    setMsg({ kind: 'info', text: '正在生成预览…' });
    const r = await previewBot();
    if (r.ok) { setPreview({ html: r.html, count: r.count }); setMsg({ kind: 'ok', text: '共 ' + r.count + ' 条（预览不会标记为已推送）' }); }
    else setMsg({ kind: 'err', text: r.error || '预览失败' });
  }

  async function doPush() {
    if (!cfg.pushChatId) { setMsg({ kind: 'err', text: '还没设置推送目标。在群里发 /sub 可自动填入。' }); return; }
    setBusy(true);
    setMsg({ kind: 'info', text: '正在推送…' });
    const r = await pushBot({ chatId: cfg.pushChatId });
    setBusy(false);
    if (r.ok) { setMsg({ kind: 'ok', text: '已推送 ' + r.sent + ' 条到 ' + r.chatId }); refresh(); }
    else setMsg({ kind: 'err', text: r.error || '推送失败' });
  }

  const box: any = { width: '100%', margin: '4px 0 12px' };
  const lbl: any = { fontSize: 12.5, color: 'var(--fg-mute)' };
  const card: any = { background: 'var(--bg-2)', border: '1px solid var(--border-soft)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 };

  return (
    <div>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderColor: status.running ? 'var(--green)' : 'var(--border-soft)' }}>
        <span style={{ width: 9, height: 9, borderRadius: 5, background: status.running ? 'var(--green)' : 'var(--fg-mute)' }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 650, fontSize: 14 }}>
            {status.running ? '机器人运行中' : (cfg.enabled && cfg.hasToken ? '已启用，未运行' : '机器人未启用')}
            {status.me && <span style={{ color: 'var(--fg-dim)', fontWeight: 400 }}>{' · @' + status.me.username}</span>}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-mute)' }}>
            {'已处理消息 ' + (status.updates || 0) + ' 条 · 已推送条目 ' + cfg.pushedCount + (cfg.lastPushDate ? ' · 上次推送 ' + cfg.lastPushDate : '')}
          </div>
        </div>
        <button className="btn" onClick={() => doSave(true)} disabled={busy}>保存并重启</button>
        <button className="btn ghost" onClick={async () => { await stopBot(); refresh(); setMsg({ kind: 'info', text: '已停止' }); }}>停止</button>
      </div>

      {status.lastError && (
        <div style={{ ...card, borderColor: 'var(--rose)', color: 'var(--rose)', fontSize: 13 }}>{'最近错误：' + status.lastError}</div>
      )}

      <div style={card}>
        <div style={{ fontWeight: 650, marginBottom: 8 }}>1. 填入 Bot Token</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-dim)', lineHeight: 1.8, marginBottom: 10 }}>
          在 Telegram 里找 <a className="link" href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> → 发 <code>/newbot</code> → 拿到形如 <code>123456:ABC-DEF...</code> 的 Token。
          然后把这个机器人**拉进你的群**（要推送频道就设为管理员）。
        </div>
        <label style={lbl}>Token {cfg.hasToken && <span style={{ color: 'var(--green)' }}>· 已保存 {cfg.tokenHint}（留空不修改）</span>}</label>
        <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" style={box} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={doTest} disabled={busy}>校验 Token</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5 }}>
            <input type="checkbox" checked={cfg.enabled} onChange={e => upd('enabled', e.target.checked)} style={{ width: 'auto', margin: 0 }} />
            启用机器人（保存后生效）
          </label>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 650, marginBottom: 8 }}>2. 推送目标</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-dim)', lineHeight: 1.8, marginBottom: 10 }}>
          最省事的办法：把机器人拉进群，然后在群里发一条 <code>/sub</code>，目标 chat id 会自动填到这里（8 秒内刷新）。
          也可以发 <code>/id</code> 查看 chat id 后手动粘贴。
        </div>
        <label style={lbl}>推送目标 chat id</label>
        <input value={cfg.pushChatId} onChange={e => upd('pushChatId', e.target.value)} placeholder="-1001234567890" style={box} />
        <label style={lbl}>只允许这些群使用（可选，逗号分隔；留空=所有群都能用）</label>
        <input value={cfg.allowedChatIds} onChange={e => upd('allowedChatIds', e.target.value)} placeholder="-1001234567890, -1009876543210" style={box} />
      </div>

      <div style={card}>
        <div style={{ fontWeight: 650, marginBottom: 8 }}>3. 日报内容</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px' }}>
            <label style={lbl}>最低价值分 {cfg.pushMinValue}</label>
            <input type="range" min={3} max={8} step={0.5} value={cfg.pushMinValue} onChange={e => upd('pushMinValue', Number(e.target.value))} style={{ width: '100%' }} />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={lbl}>每天最多 {cfg.pushLimit} 条</label>
            <input type="range" min={3} max={20} step={1} value={cfg.pushLimit} onChange={e => upd('pushLimit', Number(e.target.value))} style={{ width: '100%' }} />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={lbl}>时间窗口 {cfg.windowDays} 天</label>
            <input type="range" min={1} max={14} step={1} value={cfg.windowDays} onChange={e => upd('windowDays', Number(e.target.value))} style={{ width: '100%' }} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={lbl}>只推送带这些标签的内容</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {TAGS.map(t => (
              <span key={t} className={'chip' + (cfg.pushTags.includes(t) ? ' on' : '')}
                onClick={() => upd('pushTags', cfg.pushTags.includes(t) ? cfg.pushTags.filter(x => x !== t) : cfg.pushTags.concat([t]))}>{t}</span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5 }}>
            <input type="checkbox" checked={cfg.autoPush} onChange={e => upd('autoPush', e.target.checked)} style={{ width: 'auto', margin: 0 }} />
            每天自动推送
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5 }}>
            推送时间
            <select value={cfg.pushHour} onChange={e => upd('pushHour', Number(e.target.value))} style={{ padding: '4px 8px' }}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5 }}>
            <input type="checkbox" checked={cfg.allowAsk} onChange={e => upd('allowAsk', e.target.checked)} style={{ width: 'auto', margin: 0 }} />
            允许群内 /ask 提问（消耗 AI 额度）
          </label>
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-mute)', marginTop: 10 }}>
          自动推送只会发**没推过的新条目**（已推送的会记住，不会重复刷屏）。服务需要在推送时间处于运行状态。
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 650, marginBottom: 8 }}>4. 反向收录：把群里的情报收进库</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-dim)', lineHeight: 1.85, marginBottom: 10 }}>
          Telegram 的群没有公开预览页，所以之前抓不到群（比如 @qiuyueww）。但机器人进群后能收到消息 —— 开启后，群里聊到的工具/羊毛会自动分类、去重，并进入同一个检索库，也能被 AI 问答检索到。
          <br />
          要让机器人读到<b>普通消息</b>（而不只是命令），二选一：把机器人<b>设为群管理员</b>（最简单）；或在 @BotFather 里 <code>/setprivacy</code> 关闭隐私模式后，把机器人移出群再重新拉进来。
        </div>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5 }}>
            <input type="checkbox" checked={cfg.ingestGroups} onChange={e => upd('ingestGroups', e.target.checked)} style={{ width: 'auto', margin: 0 }} />
            收录群消息
          </label>
          <span style={{ fontSize: 13, color: 'var(--fg-mute)' }}>
            本次运行已收录 <b style={{ color: 'var(--green)' }}>{cfg.ingestedCount || 0}</b> 条
            {cfg.lastIngest && <span>{' · 最近：' + cfg.lastIngest.chat + '「' + String(cfg.lastIngest.text || '').slice(0, 18) + '…」'}</span>}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn" onClick={doPreview}>预览日报</button>
        <button className="btn primary" onClick={doPush} disabled={busy}>立即推送一次</button>
        <button className="btn" onClick={() => doSave(true)} disabled={busy}>保存全部设置</button>
      </div>

      {msg && (
        <div style={{ marginTop: 14, padding: '10px 13px', borderRadius: 10, fontSize: 13, background: msg.kind === 'err' ? 'color-mix(in srgb, var(--rose) 13%, transparent)' : msg.kind === 'ok' ? 'color-mix(in srgb, var(--green) 13%, transparent)' : 'var(--bg-3)', color: msg.kind === 'err' ? 'var(--rose)' : msg.kind === 'ok' ? 'var(--green)' : 'var(--fg-dim)' }}>{msg.text}</div>
      )}

      {preview && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12.5, color: 'var(--fg-mute)', marginBottom: 8 }}>推送效果预览（共 {preview.count} 条）</div>
          <div style={{ background: '#17212b', borderRadius: 12, padding: '14px 16px', color: '#e9eff7', fontSize: 13.5, lineHeight: 1.75, maxHeight: 380, overflowY: 'auto', border: '1px solid var(--border)' }}>
            <div dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-mute)', marginTop: 6 }}>以上为 Telegram HTML 渲染效果，实际发送后 <code>&lt;b&gt;</code> 会变成粗体、链接可点击。</div>
        </div>
      )}
    </div>
  );
}
