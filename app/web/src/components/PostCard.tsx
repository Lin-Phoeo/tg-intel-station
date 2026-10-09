import { Post } from '../api';
import { catColor, highlight, splitTitleBody, timeAgo, fmtNum, cx } from '../lib/util';

export function PostCard({ post, active, terms, onOpen }: { post: Post; active: boolean; terms: string[]; onOpen: (p: Post) => void }) {
  const { title, body } = splitTitleBody(post.text);
  const c = catColor(post.category);
  const isFree = post.tags.includes('免费') || post.tags.includes('限时');
  return (
    <article className={cx('card', 'anim-in', active && 'active')} style={{ padding: '15px 17px', cursor: 'pointer' }} onClick={() => onOpen(post)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 7 }}>
        <span className="badge" style={{ background: 'color-mix(in srgb, ' + c + ' 16%, transparent)', color: c }}>{post.category}</span>
        {post.value >= 6 && <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{'★ ' + post.value.toFixed(1)}</span>}
        {isFree && <span className="badge" style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)', color: 'var(--green)' }}>羊毛</span>}
        <span style={{ color: 'var(--fg-mute)', fontSize: 12.5 }}>{post.date}</span>
        <span style={{ color: 'var(--fg-mute)', fontSize: 12.5 }}>· {timeAgo(post.date)}</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--fg-mute)', fontSize: 12.5 }}>{'@' + post.channel}</span>
      </div>

      <div style={{ fontWeight: 650, fontSize: '1.02em', lineHeight: 1.55, marginBottom: 5 }}>{highlight(title, terms)}</div>
      {body.trim() && (
        <div className="text-body clamp-4" style={{ color: 'var(--fg-dim)', fontSize: '.94em', lineHeight: 1.68 }}>{highlight(body.trim(), terms)}</div>
      )}

      {(post.tags.length > 0 || post.links.length > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {post.tags.slice(0, 4).map(t => <span key={t} className="chip flat" style={{ fontSize: 11.5, padding: '1px 9px' }}>{t}</span>)}
          {post.links[0] && (
            <span style={{ flex: 1 }} />
          )}
          {post.links[0] && (
            <a className="link" style={{ fontSize: 12.5 }} href={post.links[0]} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
              {post.domains[0] || '打开链接'} ↗
            </a>
          )}
          <span style={{ color: 'var(--fg-mute)', fontSize: 12 }}>{fmtNum(post.views) + ' 阅读'}</span>
        </div>
      )}
    </article>
  );
}
