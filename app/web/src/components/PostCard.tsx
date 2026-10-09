import { Star } from 'lucide-react';
import { Post } from '../api';
import { catColor, highlight, splitTitleBody, timeAgo, fmtNum, cx } from '../lib/util';

// 列表项而非卡片。理由：
// ① 一页 40 条，卡片有边框和内边距，视觉噪音大、占高度
// ② 卡片逼着每条都"自成一格"，反而看不清哪些是同类的
// ③ 列表靠悬停底色就能表达可点，不需要边框
//
// 信息分三层（详略得当）：
//   常驻：分类 · 关键标签 · 标题 · 正文两行 · 来源数 · 域名 · 阅读 · 时间
//   详情：其余标签、价值分、全部链接 → 点击后在右侧面板展开
// 刻意去掉：价值分数字（只用来排序，数字没有直觉意义）
const KEY_TAGS = ['免费', '限时', '风险', '开源'];

export function PostCard({ post, active, terms, onOpen }: { post: Post; active: boolean; terms: string[]; onOpen: (p: Post) => void }) {
  const { title, body } = splitTitleBody(post.text);
  const c = catColor(post.category);
  const key = post.tags.filter(t => KEY_TAGS.includes(t)).slice(0, 3);

  return (
    <article className={cx('row', 'anim-in', active && 'active')} onClick={() => onOpen(post)}>
      {/* 元信息行：色点 · 分类 · 关键标签 ······ 来源数 · 域名 · 阅读 · 时间 */}
      <div className="row-meta">
        <span className="row-dot" style={{ background: c }} />
        <span style={{ color: c, fontWeight: 600 }}>{post.category}</span>
        {key.map(t => <span key={t} className={'mtag' + (t === '风险' ? ' risk' : '')}>{t}</span>)}
        <span style={{ flex: 1, minWidth: 8 }} />
        {post.clusterSize > 1 && <span title={'同一事件被 ' + post.clusterSize + ' 个来源发布，已合并显示'}>{post.clusterSize + ' 个来源'}</span>}
        {post.links[0] ? (
          <a className="row-link" href={post.links[0]} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} title={post.links[0]}>
            {post.domains[0] || '链接'} ↗
          </a>
        ) : null}
        {post.views > 0 && <span className="hidable">{fmtNum(post.views) + ' 阅读'}</span>}
        <span>{timeAgo(post.date)}</span>
      </div>

      <div className="row-title">{highlight(title, terms)}</div>
      {body.trim() && <div className="text-body clamp-2 row-body">{highlight(body.trim(), terms)}</div>}

      {active && <Star size={13} strokeWidth={2} className="row-star" />}
    </article>
  );
}
