# 电报情报站 · 本地技术线报与项目雷达

把抓取到的 **85 万条** Telegram 公开频道帖子，变成一个可以秒级检索、并且能向 AI 提问的本地应用。

## 快速开始

双击 **启动情报站.cmd**，浏览器会自动打开 http://127.0.0.1:8317

（若提示索引不存在，先运行一次：`node app/server/build-db.mjs`）

## 功能

- **全文检索**：85 万条帖子，SQLite FTS5 三元组索引，中文子串秒级命中，支持关键词高亮
- **多维筛选**：分类 / 标签 / 频道 / 时间范围 / 排序（相关度·价值分·最新·热度）
- **卡片信息流**：无限滚动，按价值分排序，自动标注「羊毛」「★高分」
- **详情面板**：全文、相关链接、相关内容推荐、收藏、一键让 AI 分析
- **AI 情报助手**：先检索再回答，回答里的 [1][2] 可点开对应原文；未配置模型时退化为检索原文
- **多服务商切换**：像 ccswitch 一样保存多个服务商并随时切换，支持自建/第三方中转站
- **收藏 / 深浅主题 / 字号调节 / URL 可分享**（?q=&cat=&post=&theme=）

## 配置 AI

点左下角 ⚙ → 「添加服务商」选择预设 → 填 API Key → 测试 → 保存。
顶栏的下拉框可以随时切换服务商。密钥只保存在本机 `app/data/settings.json`，不会外传。

内置预设：DeepSeek、硅基流动、智谱 GLM、OpenAI、Moonshot、阿里通义、火山方舟、OpenRouter、自定义中转。

填好 Base URL 和 API Key 后，点模型名右侧的 **获取模型** 会自动拉取该服务商的可用模型列表（带搜索过滤），直接选即可，不用手敲模型名。
接口路径与返回格式自动兼容（OpenAI `data[].id` / 智谱 `models[].slug` / Anthropic `data[].id`），并自动剥离 `/anthropic` 等兼容子路径重试；401 提示 Key 无效，全部 404 则提示手动填写。鉴权方式可切换 Bearer / x-api-key / x-goog-api-key。
「自定义中转」支持填写任意 OpenAI 兼容 Base URL，并可附加自定义请求头（JSON）。

## 目录结构

    app/server/build-db.mjs   从 data/clean.jsonl 构建 SQLite + FTS5 索引（约 1.5 GB）
    app/server/store.mjs      检索、短词回退、分类统计、关联推荐
    app/server/ai.mjs         多服务商配置、RAG 检索、流式输出
    app/server/index.mjs      HTTP API + 静态资源服务
    app/web/                  React 19 + Vite 8 + Tailwind 4 前端
    app/data/intel.db         索引数据库
    app/data/settings.json    AI 服务商配置

## 开发模式

    node app/server/index.mjs          # 后端 :8317
    cd app/web && npm run dev          # 前端 :5317（已配置 /api 代理）

改完前端要正式生效：

    cd app/web && npm run build        # 输出到 app/web/dist

## API

    GET  /api/search?q=&category=&tags=&channel=&from=&sort=&page=&size=
    GET  /api/facets
    GET  /api/post/:id
    GET  /api/related/:id
    GET  /api/settings              POST /api/settings
    POST /api/settings/active       # 切换当前服务商
    POST /api/settings/test         # 测试连通性
    POST /api/chat                  # SSE 流式问答

## 数据更新

    npm run fetch            # 增量抓取（已完成分段自动跳过）
    npm run index:build      # 从 data/raw 全量重建数据库
    npm run report           # 重新生成报告
