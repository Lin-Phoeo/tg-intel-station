# OmniRush 上下文目录

这个目录包含了 Claude Code 会话的关键上下文,帮助 OmniRush.ai 快速了解项目当前状态。

> 注意：本目录只是上下文文档导出，不会自动创建 workspace/session，也不代表完整会话迁移；权威交接文档是 `docs/07-交接文档.md`。

## 文件说明

### `session-context.md`
**最新会话总结** (2026-10-11)
- 本次会话完成的 6 个 commit 详解
- 检索优化: Hit@10 83%→91%（83%→87% 为标答校准，87%→91% 为时效门控提升）
- UI 四批精修 + 每日简报 AI 导读
- 已验证的负收益方案记录
- 下一步高价值方向建议

### `HANDOFF.md`
**已改为入口**：指向权威交接文档 `docs/07-交接文档.md`（原 2026-10-10 完整副本内容已过时，历史版本见 git：`git show 656caa4:.omnirush/HANDOFF.md`）

### `memory/`
**持久记忆文件**
- `subagent-serial-limit-anyrouter-only.md`: Subagent 并行限制仅适用于 anyrouter 网关

## 快速开始

### 1. 了解项目现状
```bash
# 先读权威交接文档
cat docs/07-交接文档.md

# 再看最新会话做了什么
cat .omnirush/session-context.md
```

### 2. 查看最近的改动
```bash
git log --oneline -6
# 79076a7 chore(ui): 详情面板去死代码 + 数字 tabular-nums
# f1093e4 feat(ui): 暗色色阶换 Linear 官方梯
# d820252 feat(ui): 问答 Perplexity 式横滚来源卡
# 11cba38 feat(ui): 信息流/排版精修第一批
# e384bca feat(bot): 每日简报 AI 导读 + 设置面板修复
# 3989abf feat(rag): 时效衰减门控 + 修评测标答 83%→91%
```

### 3. 验证测试和评测
```bash
npm test                    # 当前工作区应为 85 项顶层测试，另执行子进程 fixture（含本批边界回归）
npm run eval:rag            # 当前检索回归；日期固定时解释时效结果
npm run eval:rag:strict     # 检索门禁
npm run build:web           # 构建通过
```

### 4. 启动服务
```bash
# Windows: 双击「启动情报站.cmd」
# 或手动:
npm start
# 访问 http://127.0.0.1:8317
```

## 核心成果

### 检索优化 ✅
- **Hit@10**: 83% → 91%（83%→87% 为评测标答校准，87%→91% 为时效门控的真实提升）
- **MRR**: 0.656 → 0.705
- **方法**: 时效型查询加日期衰减门控（半衰期 10 天，仅时效意图触发）
- **负结果**（仅该组参数/语料）: MMR 重排、query2doc

### UI 精修 ✅
- 等宽数字 + 行宽收口 + 选中强调条
- 骨架屏 + 空状态优化
- Perplexity 式横滚来源卡
- Linear 官方色阶 (可能需用户审查)

### 每日简报 ⚠️
- AI 导读开关、调度/去重代码就绪
- 修复设置面板轮询冲掉编辑的 bug
- 实际投递需接入真实机器人（待用户配置与授权）

## 待用户确认

1. **Linear 新色阶审查**: 启动服务看看新的暗色方案是否满意
2. **下一步方向**: 四个高价值方向见 `session-context.md` 末尾

## 注意事项

- 所有改动都有单测 + 构建 + 浏览器实测验证
- 负结果(MMR/query2doc)已记录在 `docs/07-交接文档.md` 第五节,避免重复尝试
- 时效衰减门控默认关闭,只有明确时效型查询才触发
- UI 改动基于 Linear/Geist/Refactoring UI 调研,渐进式而非推倒重来

---
更新时间: 2026-10-13（检索正确性修复批次后修订）
会话: Claude Code (Fable 5.1)
