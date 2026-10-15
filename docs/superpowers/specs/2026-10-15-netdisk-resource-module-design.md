# 网盘资源结构化提取模块设计

**状态：** 用户已在对话中确认页面形态、提取方式、AI 整理范围与不联网约束。本文记录已批准的设计，供实现计划引用。

## 目标

把情报库（`posts`，约 96 万条）里散落在各频道帖子中的网盘分享链接，抽成结构化条目：平台、分享链接、提取码、资源名、类别、标签、简介、来源频道与原帖。用一个独立页面浏览、筛选、看详情与全部来源，并用 AI 把杂乱的标题与分类整理干净。

## 调研结论（不重复造轮子）

- 采用 `syhyz1990/panAI`（油猴脚本）已有的平台识别方案作为蓝本：每个平台一条「域名正则 + 分享链接正则 + 中文名」，覆盖百度/阿里/微云/蓝奏/天翼/移动/迅雷/123/360/115/奶牛/城通/夸克/FlowUs 等。不自己发明正则。
- 采用 panAI 的提取码正则：`/wss:[a-zA-Z0-9]+|(?<=\s*(?:密|提取|访问|訪問|key|password|pwd|#|\?p=)\s*[码碼]?\s*[：:=]?\s*)[a-zA-Z0-9]{3,8}/i`，并额外读取 URL 上的 `pwd=`/`p=` 查询参数。
- `baidu-wangpan-parse`、`CloudSaver` 等工具依赖联网与登录态解析真实文件名，与本项目「不联网」约束冲突，不采用。
- 语料实测出现的平台约 24 种、合计约 1 万条帖子：夸克约 5400、百度约 2100、蓝奏约 1460、阿里云盘约 295、123 盘约 250、天翼约 88、迅雷约 72、和彩云约 47、UC 约 38、Google Drive 约 104、MEGA 约 20，其余为个位数。平台表按完整移植，UI 按命中量排序展示。

## 用户流程

- 左侧导航新增「网盘资源」，与信息流、收藏并列，点击后主内容区整块切换到该页面。
- 页面顶部为筛选条：平台、类别、关键词、日期范围、排序；工具栏为「扫描更新」「AI 整理」「导出」。
- 列表卡片展示：平台徽标、资源名（优先 AI 标题）、类别、标签、提取码（一键复制）、来源频道与日期、价值分。
- 点击卡片打开详情抽屉：完整字段、AI 简介、全部来源（合并的频道与原帖）、一键复制「链接+提取码」、跳转原帖。
- 「扫描更新」跑一次全量/增量提取；「一键补齐」完成后自动跑一次增量提取（纯本地、不联网、不耗 AI）。
- 「AI 整理」为手动触发的后台任务，可看进度、可停、可续跑、可限条数。

## 数据模型

新增表 `netdisk_resources`（由 `store.mjs` 建表，保持「store 是唯一写库方」不变）：

- `id` INTEGER PRIMARY KEY
- `platform` TEXT —— quark/baidu/aliyun/lanzou/pan123/xunlei/115/tianyi/caiyun/weiyun/uc/ctfile/cowtransfer/wenshushu/jianguoyun/flowus/google/mega/pikpak/other
- `share_url` TEXT —— 规范化后的分享链接（去追踪参数）
- `share_key` TEXT —— 平台内分享码（如夸克 `/s/<code>`），用于去重
- `pwd` TEXT —— 提取码，可为空
- `title` TEXT —— 规则清洗出的资源名
- `ai_title` TEXT —— AI 规范化标题（可为空）
- `ai_summary` TEXT —— AI 简介（可为空）
- `category` TEXT —— AI 类别（可为空）
- `tags` TEXT —— 逗号分隔标签
- `post_id` INTEGER、`channel` TEXT、`post_date` TEXT、`value` REAL —— 主来源
- `sources` TEXT —— JSON 数组，合并的全部来源：`[{post_id, channel, date, url, value}]`
- `merge_count` INTEGER
- `created_at`、`updated_at`、`ai_at` TEXT —— `ai_at` 为空表示未整理

约束与索引：`UNIQUE(platform, share_key)`；`INDEX(platform)`、`INDEX(category)`、`INDEX(post_id)`、`INDEX(ai_at)`。

## 提取管线（`app/server/netdisk.mjs`）

- `PLATFORMS`：平台表，移植 panAI 的域名正则、分享链接正则与中文名；蓝奏多云域名（`lanzou[a-z]`、`lanzn.com`）归一为 `lanzou`；123 盘多域名（`123pan.com`、`123684.com`、`123865.com`、`123912.com`、`*.share.123pan.cn`）归一为 `pan123`。
- `detectPlatform(url)` → `{platform, shareKey}` 或 `null`。
- `parsePwd(text, url)` → 提取码或空串（用 panAI 正则 + URL `pwd`/`p` 参数）。
- `cleanTitle(text)` → 剥离 `🙂标题：/说明：/下载地址：/标签：` 等模板噪音，取干净资源名；纯规则，不耗 AI。
- `scanPosts(mode)` → 用 `domains` 预筛（`LIKE '%pan.quark.cn%' OR ...`）缩小范围，解析 `links` 列，按唯一键 upsert；命中已有条目则并入 `sources` 并累加 `merge_count`。增量用 `app_state.netdisk:scannedPostId` 记录已处理的最大帖子 id（帖子 id 单调递增，增量成本极低）；全量扫描忽略该游标。

## AI 整理（复用 `ai-classify.mjs` 范式，手动触发）

- 固定类别集：软件工具 / 教程课程 / 影视 / 音乐 / 游戏 / 电子书 / 素材模板 / 系统镜像 / 办公文档 / 其他。
- 批量取 `ai_at IS NULL` 的条目，喂「资源名 + 原帖片段」，按 `序号|类别|标签|简介|规范标题` 定长行输出，容错解析后写回 `category/tags/ai_summary/ai_title/ai_at`。
- 后台任务：进度、停止、续跑、限条数；默认不自动跑（消耗额度），失败连续多次即中止并报错。

## API 路由（`index.mjs`）

- `GET /api/netdisk` —— 筛选：platform、category、q、from/to、sort、page、size；返回 `{total, items, page, size}`。
- `GET /api/netdisk/facets` —— 平台与类别计数。
- `GET /api/netdisk/:id` —— 详情，含全部来源。
- `GET /api/netdisk/export` —— 按当前筛选导出 Markdown/CSV/JSON。
- `POST /api/netdisk/scan` + `GET /api/netdisk/scan/status`。
- `POST /api/netdisk/ai` + `GET /api/netdisk/ai/status` + `POST /api/netdisk/ai/stop`。
- 复用现有校验风格：类型、范围、长度、日期边界。

## 前端（`app/web/src/components/NetdiskPanel.tsx`）

- 新增 `view` 值 `netdisk`，主内容区渲染整块页面；左侧导航新增按钮；命令面板新增入口。
- 筛选控件与列表卡片、详情抽屉、复制、导出如上「用户流程」。
- 新增 API 客户端函数与类型（`api.ts`）。

## 非目标

- 不联网抓取分享页的真实文件名与大小；资源名只取自帖子文本。
- 不改检索/RAG/评测标答、Telegram、`posts` 表结构、现有日报与同步逻辑。
- 不做同一文件换分享码重传的内容级去重（需内容哈希，超出范围）。
- 不自动跑全库 AI 整理。

## 已知限制

- 资源名来自帖子文本，非分享页真实文件名。
- 不联网无法判断分享是否失效，UI 标注「链接来自原帖，可能已失效」。
- 跨平台同内容（同一资源分别传夸克与百度）视为两条，不合并；合并只发生在「同一链接被多频道分享」。

## 验收标准

- 全量扫描后，语料中约 1 万条网盘帖抽成结构化条目；同一分享链接被多频道分享时合并为一条且 `sources` 列全来源。
- 平台识别、提取码解析、标题清洗用固定 fixture 断言；蓝奏/123 盘多域名正确归一。
- 增量扫描只处理游标之后的新帖子；重复扫描幂等，不产生重复条目。
- AI 整理按类别集输出，写回后可续跑；未整理条目 `ai_at` 为空。
- 筛选、分页、详情、导出结果一致；导出内容只含当前筛选结果。
- 扫描与 AI 整理不修改 `posts`、不改检索索引、不触发联网。
- 用隔离临时库测试服务层与路由；改动后运行 `npm test`、`npm run build:web`，并起服务用浏览器验证完整路径（筛选、扫描、AI 整理、详情、复制、导出）。
