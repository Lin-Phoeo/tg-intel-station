// 重建全文索引（单字分词）。数据已经是最终的，只重算索引。
import * as store from '../app/server/store.mjs';

const t0 = Date.now();
const n = store.rebuildFts();
console.log('已索引 ' + n.toLocaleString() + ' 条，耗时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
store.close();
