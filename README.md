# 电报情报站 · Telegram Intel Station

把 Telegram 公开频道里的**技术线报、羊毛优惠、开源项目、副业信息**，抓下来、洗干净、做成一个能秒级检索、还能直接向 AI 提问的本地应用。

> 已抓取 11 个频道、**860,649 条**原始帖子 → 清洗去重后 **852,433 条**有效内容 → 索引入库，全文搜索 **30–60ms**。

![信息流](app/预览-信息流.png)

## 它由两部分组成

| 模块 | 作用 |
|---|---|
| **数据管道**（`scrape/`） | 抓取 → 去重 → 反垃圾 → 分类打分 |
| **本地应用**（`app/`） | SQLite FTS5 全文检索 + React 界面 + AI 问答 |

## 快速开始

```bash
# 1. 抓取（支持断点续跑，已完成的频道会跳过）
node scrape/scrape.mjs

# 2. 清洗、去重、分类
node scrape/build.mjs

# 3. 建检索索引（约 1.5GB，需要几分钟）
node app/server/build-db.mjs

# 4. 启动应用
双击「启动情报站.cmd」，或手动：
node app/server/index.mjs      # → http://127.0.0.1:8317
```

首次启动如果 `app/web/dist` 不存在，启动脚本会自动 `npm install` + `npm run build`。
也可以手动：`cd app/web && npm install && npm run build`

## 抓取原理

用的是 Telegram 官方**公开预览页** `t.me/s/<频道>?before=<消息ID>`：

- **无需登录、无需 Bot Token、不涉及私密内容**，只采集任何人打开网页都能看到的信息
- 深位跳跃实测**没有历史深度限制**，可以一直回溯到频道第一条帖子（已用 JIKE0906 验证到 id=1）
- 56 并发稳定跑满，46,731 次请求 13.5 分钟抓完 86 万条
- 分段写入 + `.done` 标记，**断点续跑**

## 数据流水线

```
t.me/s/<频道>  ──scrape.mjs──▶  data/raw/<频道>/seg_*.jsonl
                                      │
                                 build.mjs（去重 + 反垃圾 + 分类打分）
                                      ▼
                    data/clean.jsonl（852,433 条）
                    data/valuable.jsonl（320,833 条精选）
                                      │
                              build-db.mjs（SQLite + FTS5 三元组索引）
                                      ▼
                              app/data/intel.db（1.5GB）
```

**分类维度**：羊毛优惠 / 项目副业 / 实用工具 / 开源项目 / AI与科技 / 服务器网络 / 账号会员 / 学习资源 / 数码硬件 / 资讯热点

**过滤**：广告投放、黑产（博彩·色情·跑分）、招代理、纯链接刷屏、跨频道重复转发、需要联系方式引流的短帖。

## 应用功能

| 功能 | 说明 |
|---|---|
| 全文检索 | SQLite FTS5 三元组索引，中文子串匹配，关键词高亮 |
| 多维筛选 | 分类 / 标签 / 频道 / 时间范围 / 排序（相关度·价值分·最新·热度） |
| 卡片信息流 | 无限滚动，自动标注「羊毛」与高分条目 |
| 详情面板 | 全文、相关链接、相关内容推荐、收藏、一键让 AI 分析 |
| AI 问答 | 先检索再回答，回答里的 `[1][2]` 可点开对应原文 |
| 多服务商 | 保存多个 AI 服务商随时切换，支持自建/第三方中转站 |
| 其他 | 深浅主题、字号调节、收藏、URL 可分享（`?q=&cat=&post=&theme=`） |

![详情面板](app/预览-详情面板.png)

## AI 配置

点左下角 ⚙ →「添加服务商」选预设 → 填 API Key → 测试 → 保存。顶栏下拉框随时切换。

内置预设：DeepSeek、硅基流动、智谱 GLM、OpenAI、Moonshot、阿里通义、火山方舟、OpenRouter、**自定义中转**（任意 OpenAI 兼容接口，支持附加自定义请求头）。

### 模型列表自动获取

填好 Base URL 和 API Key 后，点模型名右侧的 **获取模型**，会自动调用服务商的模型列表接口，把可用模型列出来供选择（带搜索过滤，OpenRouter 这类聚合站有几百个模型也能秒筛）。

不同厂商的接口路径和返回格式差异很大，这里参考开源项目 **farion1231/cc-switch** 的做法做了三层兼容：

- **候选地址按序尝试**：`{base}/models` → `{base}/v1/models` → `{base}/api/v1/models`，并自动剥离 `/anthropic`、`/api/coding` 等兼容子路径后重试
- **返回格式兼容**：OpenAI 的 `data[].id`、智谱的 `models[].slug`、Anthropic 的 `data[].id` 都能解析
- **错误区分**：401/403 提示 Key 无效；全部候选 404 则提示该服务商不开放模型列表 —— 此时手动填模型名即可，也可以单独填「模型接口地址」精确指定

候选地址是**并发探测**的（不是按序等待），所以失败场景下最坏只等一轮超时，而不是 N 次串行超时。

用真实服务商无 Key 探测验证过（返回 401 即说明地址猜对了，只是缺鉴权）：

| 服务商 | 命中的候选地址 | 第几个命中 |
|---|---|---|
| DeepSeek | `/v1/models` | 1 |
| 硅基流动 | `/v1/models` | 1 |
| Moonshot Kimi | `/v1/models` | 1 |
| 阿里通义 | `/compatible-mode/v1/models` | 1 |
| 火山方舟 | `/api/v3/models` | 1 |
| OpenRouter | `/v1/models` | 1（公开，实测 469 个模型） |
| 智谱 GLM | `/api/paas/v1/models` | 2 |
| Moonshot（`/anthropic` 子路径） | 剥离后 `/v1/models` | 2 |

另外支持切换 **鉴权方式**（`Authorization: Bearer` / `x-api-key` / `x-goog-api-key`），自建中转站可以自由适配。

![获取模型](app/预览-模型获取.png)

密钥只写入本机 `app/data/settings.json`，已在 `.gitignore` 中排除。

![AI 服务商设置](app/预览-AI服务商设置.png)

**不配置也能用**：AI 面板会退化为「检索原文」模式，仍然能搜、能看。

## 目录结构

```
scrape/
  telegram.mjs      t.me/s HTML 解析 + 抓取
  scrape.mjs        全量/增量抓取（分段并行、可续跑）
  classify.mjs      分类、反垃圾、价值打分
  build.mjs         去重 + 生成 clean/valuable 数据集
  report.mjs        生成 Markdown 分类报告与 CSV
  rankings.mjs      高频资源网站 / 推荐频道榜
app/
  server/
    build-db.mjs    构建 SQLite + FTS5 索引
    store.mjs       检索、短词回退、分类统计、关联推荐
    ai.mjs          多服务商配置、RAG 检索、流式输出
    index.mjs       HTTP API + 静态资源服务
  web/              React 19 + Vite 8 + Tailwind 4
    src/App.tsx     应用主壳
    src/components/ PostCard / Detail / ChatPanel / SettingsModal / Markdown
output/
  分类报告/          各分类精选清单（Markdown）
  00-总览与使用说明.md
  01-深度洞察与变现建议.md
```

## API

```
GET  /api/search?q=&category=&tags=&channel=&from=&sort=&page=&size=
GET  /api/facets                    # 分类/频道/标签统计
GET  /api/post/:id
GET  /api/related/:id               # 相关内容推荐
GET  /api/settings                  POST /api/settings
POST /api/settings/active           # 切换当前 AI 服务商
POST /api/settings/test             # 测试连通性
POST /api/chat                      # SSE 流式问答
```

## 开发

```bash
node app/server/index.mjs    # 后端 :8317
cd app/web && npm run dev    # 前端 :5317（已配置 /api 代理到 8317）
```

改完后端直接重启进程；改完前端要 `npm run build` 才会作用到 :8317。

## 数据说明

仓库**不包含**抓取到的数据、索引数据库和生成的大体积导出（合计约 3GB），只保留：

- 全部**源码**
- `data/stats.json`（数据集统计）
- `output/分类报告/*.md`（生成的精选报告，可直接阅读）

按上面「快速开始」跑一遍即可完整复现。

## 免责声明

- 所有内容均来自 Telegram **公开频道**的公开信息，版权归原作者所有，仅供学习研究。
- 数据源中包含破解软件、第三方节点、账号交易等灰色内容，请自行判断风险；标签含「风险」「破解」的条目在报告中已标注。
- 本项目只做信息聚合与检索，不对任何第三方资源的可用性、合法性负责。
