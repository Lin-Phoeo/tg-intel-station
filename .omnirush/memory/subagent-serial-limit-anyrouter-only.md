---
name: subagent-serial-limit-anyrouter-only
description: 「同一时间最多 1 个 subagent」只在 anyrouter 网关下成立，换供应商后可并行
metadata:
  node_type: memory
  type: feedback
  originSessionId: 74e5563c-f465-48f2-be75-f9e62e42557c
  modified: 2026-10-10T22:14:52.492Z
---

全局 CLAUDE.md §四 的硬规则「subagent 串行、同一时间最多 1 个」是**专门为 anyrouter 网关**定的。2026-10-10 用户明确澄清：当前已换到其它供应商，这条限制不再适用，可以并行派发多个 subagent。

**Why:** 该限制源于 anyrouter 的并发/压缩稳定性问题，不是通用约束。
**How to apply:** 非 anyrouter 网关下，有 2+ 彼此独立的任务时放心并行派 subagent（同一条消息里发多个 Agent tool call）；只有确认在 anyrouter 上才回到串行。先确认当前网关再决定。
