// 排序与打分表达式（纯函数）
export const BM25_WEIGHTS = [8.0, 3.0, 2.0, 1.0];
export const VALUE_BLEND = 0.5;

export function bm25Expr(table) {
  const t = table || 'posts_fts';
  return 'bm25(' + t + ', ' + BM25_WEIGHTS.join(', ') + ')';
}

// 相关度 = bm25 - 价值分 * 权重（综合排序，避免只看词频）
export function relevanceExpr(table) {
  return '(' + bm25Expr(table) + ' - p.value * ' + VALUE_BLEND + ') ASC';
}

// 无 FTS 参与时的排序（like / browse 分支）
export function orderBySimple(sort) {
  switch (sort) {
    case 'date': return 'p.date DESC, p.ts DESC';
    case 'views': return 'p.views DESC';
    default: return 'p.value DESC, p.ts DESC';
  }
}

export function orderBy(sort, table) {
  switch (sort) {
    case 'date': return 'p.date DESC, p.ts DESC';
    case 'views': return 'p.views DESC';
    case 'value': return 'p.value DESC, p.ts DESC';
    default: return relevanceExpr(table);
  }
}
