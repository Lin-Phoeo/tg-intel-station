import { Post } from '../api';
import { catColor, timeAgo, fmtNum } from '../lib/util';

export function Detail({ post, rel, fav, onFav, onOpen, onAsk }: {
  post: Post; rel: Post[]; fav: boolean;
  onFav: (p: Post) => void; onOpen: (p: Post) => void; onAsk: (p: Post) => void;
}) {
  const c = catColor(post.category);
  const allLinks = Array.from(new Set([...(post.links || [])]));
  return (
    <div className="anim-in" style={{ padding: '20px 22px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="badge" style={{ background: 'color-mix(in srgb, ' + c + ' 16%, transparent)', color: c }}>{post.category}</span>
        <span style={{ color: 'var(--fg-mute)', fontSize: 12.5 }}>{post.date} · {timeAgo(post.date)}</span>
        <span style={{ flex: 1 }} />
        <button className="btn ghost" title="收藏" onClick={() => onFav(post)} style={{ color: fav ? 'var(--amber)' : 'var(--fg-dim)' }}>{fav ? '★ 已收藏' : '☆ 收藏'}</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <button className="btn" onClick={() => window.open(post.url, '_blank')}>打开 Telegram 原文 ↗</button>
        <button className="btn" onClick={() => navigator.clipboard.writeText(post.text)}>复制正文</button>
        <button className="btn primary" onClick={() => onAsk(post)}>让 AI 分析这条</button>
      </div>

      <div className="text-body" style={{ fontSize: '1em', lineHeight: 1.8, color: 'var(--fg)' }}>{post.text}</div>

      {post.hashtags && post.hashtags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
          {post.hashtags.slice(0, 10).map(h => <span key={h} className="chip flat" style={{ fontSize: 12 }}>{'#' + h}</span>)}
        </div>
      )}

      {allLinks.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 12.5, color: 'var(--fg-mute)', marginBottom: 8, letterSpacing: '.04em' }}>相关链接</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {allLinks.map(u => (
              <a key={u} className="link" href={u} target="_blank" rel="noreferrer" style={{ fontSize: 13, wordBreak: 'break-all' }}>{u}</a>
            ))}
          </div>
        </div>
      )}

      <div className="divider" style={{ margin: '22px 0 14px' }} />
      <div style={{ display: 'flex', gap: 18, fontSize: 12.5, color: 'var(--fg-mute)', flexWrap: 'wrap' }}>
        <span>来源 <a className="link" href={'https://t.me/' + post.channel} target="_blank" rel="noreferrer">{'@' + post.channel}</a></span>
        <span>阅读 {fmtNum(post.views)}</span>
        <span>价值分 {post.value}</span>
        <span>内容分 {post.content}</span>
        {post.tags.length > 0 && <span>标签 {post.tags.join(' / ')}</span>}
      </div>

      {rel && rel.length > 0 && (
        <>
          <div className="divider" style={{ margin: '22px 0 14px' }} />
          <div style={{ fontSize: 12.5, color: 'var(--fg-mute)', marginBottom: 10, letterSpacing: '.04em' }}>相关内容</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rel.map(r => (
              <div key={r.id} className="card" style={{ padding: '10px 13px', cursor: 'pointer' }} onClick={() => onOpen(r)}>
                <div style={{ fontSize: 12, color: 'var(--fg-mute)', marginBottom: 3 }}>{r.date + ' · @' + r.channel + ' · ' + r.category}</div>
                <div className="clamp-2" style={{ fontSize: 13.5, color: 'var(--fg-dim)' }}>{r.text}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
