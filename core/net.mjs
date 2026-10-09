// 网络抓取（唯一有 IO 的 core 模块），其余解析逻辑均为纯函数
export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let REQ = 0;
export function reqCount() { return REQ; }
export function resetReqCount() { REQ = 0; }

export async function fetchHtml(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
        signal: AbortSignal.timeout(30000),
      });
      REQ++;
      if (r.status === 200) return await r.text();
      if (r.status === 429 || r.status === 500 || r.status === 502) { await sleep(1200 * (i + 1)); continue; }
      return null;
    } catch (e) { await sleep(600 * (i + 1)); }
  }
  return null;
}
