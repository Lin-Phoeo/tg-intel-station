// FTS 查询构造（纯函数）
// mode='trigram'：现有索引，仅 >=3 字词可命中，短词交由调用方做 LIKE 过滤
// mode='gram'   ：单字分词索引，任意长度都转为短语查询（M4 目标）
import { splitTerms, toGram } from './text.mjs';

const FTS_SPECIAL = /["'*():^\-]/g;

// 关联推荐用：任一词命中即可（OR 语义）
export function orExpr(terms) {
  const good = (terms || [])
    .map(t => String(t).replace(FTS_SPECIAL, ''))
    .filter(t => [...t].length >= 3);
  if (!good.length) return null;
  return good.map(t => '"' + t + '"').join(' OR ');
}

export function buildQuery(q, opts) {
  const mode = (opts && opts.mode) || 'trigram';
  const terms = splitTerms(q);

  if (mode === 'gram') {
    const good = terms.map(t => toGram(t).replace(/"/g, '')).filter(Boolean);
    return {
      mode: mode, terms: terms, longTerms: terms, shortTerms: [],
      expr: good.length ? good.map(t => '"' + t + '"').join(' AND ') : null,
    };
  }

  const longTerms = terms.filter(t => [...t].length >= 3);
  const shortTerms = terms.filter(t => [...t].length < 3);
  const good = longTerms.map(t => t.replace(FTS_SPECIAL, '')).filter(t => [...t].length >= 3);
  return {
    mode: mode, terms: terms, longTerms: longTerms, shortTerms: shortTerms,
    expr: good.length ? good.map(t => '"' + t + '"').join(' AND ') : null,
  };
}
