---
name: token-cost-optimization
description: Token 成本优化与上下文管理 — 基于 QueryEngine/Compact/Cache 源码逆向
user-invocable: true
---

# Token 成本优化秘籍

> 来源：QueryEngine.ts (1295行)、compact.ts (1705行)、microCompact.ts (530行)、withRetry.ts (822行)、tokenEstimation.ts (496行) 逆向分析。

## 一、Prompt Cache 是最大的省钱利器

### 源码揭示的缓存机制

```
System Prompt (cache_control: ephemeral, scope: global)
    ↓ 缓存命中 = 读取价格（约写入的 1/10）
Tool Schemas (cache_control: ephemeral, scope: org)
    ↓ 
User Messages (无缓存)
    ↓
Assistant Response (无缓存)
```

**关键参数**：
- 缓存 TTL: 5 分钟（ephemeral）
- 高级用户可获 1 小时 TTL
- 缓存范围: system prompt 全局缓存，tool schema 组织级缓存
- cache_creation_input_tokens: 首次写入，较贵
- cache_read_input_tokens: 后续命中，约 1/10 价格

### 实战优化策略

**策略 1: 保持会话连续性**
```
BAD:  开5个独立会话做5个小任务 → 5次 cache creation
GOOD: 1个会话连续做5个任务 → 1次 creation + 4次 cache read
```
源码中 `addCacheBreakpoints()` 在消息中插入缓存断点，确保前缀稳定不变。只要 system prompt 不变，所有后续请求都能命中缓存。

**策略 2: 5 分钟规则**
```
cache TTL = 5 min
→ 两次请求间隔 < 5min = 缓存命中
→ 间隔 > 5min = 缓存失效，重新创建
```
源码中 SleepTool 的提示词明确写道：*"prompt cache expires after 5 minutes of inactivity — balance accordingly"*。如果你让 agent 在 proactive 模式下 sleep 太久，缓存会失效。

**策略 3: 快速模式的缓存锁定**
源码中 fast mode 使用 "latched headers"——锁定 session 参数防止缓存失效：
- 同一 session 内保持相同的 model、thinking config、tool schemas
- 改变任何一项都会导致缓存失效

## 二、上下文压缩：不让 token 浪费在旧信息上

### 两级压缩体系

**Level 1: Microcompact（小压缩，自动触发）**

源码中 `COMPACTABLE_TOOLS` 列表：
- File read/write/edit 的结果
- grep/glob 的搜索结果
- web search/fetch 的内容
- bash 命令输出

**触发条件**：缓存过期 + 工具结果超过阈值
**效果**：清除旧的工具结果文本，保留结构（tool_use → tool_result 对应关系不变），不破坏缓存前缀

**Level 2: Full Compact（大压缩，/compact 命令）**

源码中的处理流程：
1. `stripImagesFromMessages()` — 图片替换为 `[image]` 标记
2. `stripReinjectedAttachments()` — 删除 skill 列表（压缩后重新注入）
3. 调用 LLM 总结整个对话历史
4. 压缩后的摘要替代原始消息
5. `truncateHeadForPTLRetry()` — 如果还是太长，从最旧的消息组开始删

### 实战优化策略

**策略 4: 主动 /compact 而非等自动触发**
```
自动触发时机 = 接近 context window 上限
→ 此时已经浪费了大量 token 在超长上下文上
→ 每次 API 调用都在为旧内容付费

最佳实践:
→ 完成一个阶段性任务后立即 /compact
→ 大文件读取后立即 /compact
→ 长串 bash 输出后立即 /compact
```

**策略 5: 避免不必要的大文件读取**
```
BAD:  Read 整个 5000 行文件 → 占用大量上下文
GOOD: Read 特定行范围 (offset + limit)
GOOD: Grep 定位后只读相关部分
```
源码中 `roughTokenCountEstimation` 显示：图片/PDF 固定估算 2000 tokens，大文本按 4 bytes/token。一个 5000 行文件约消耗 5000-15000 tokens。

## 三、模型选择的成本杠杆

### 源码中的模型回退机制

```typescript
// withRetry.ts: 连续 3 次 529 错误触发回退
if (consecutive529Errors >= MAX_529_RETRIES && options.fallbackModel) {
  throw new FallbackTriggeredError(model, fallbackModel)
}
```

**策略 6: 分层使用模型**

| 任务类型 | 推荐模型 | 原因 |
|----------|----------|------|
| 代码搜索、文件导航 | haiku | 简单判断，token 便宜 |
| 常规代码编写 | sonnet | 性价比最高 |
| 架构设计、复杂推理 | opus | 质量最高但最贵 |
| skill 测试初筛 | haiku | 验证流程不验证质量 |
| 批量重构 | sonnet | 量大需控制成本 |

源码中 skill frontmatter 支持 `model: haiku` 覆盖，sub-agent 也支持 `model` 参数。

**策略 7: Thinking Mode 的成本权衡**
```
adaptive thinking (最新模型) = 模型自己决定思考深度
budget thinking (旧模型) = 固定 token 预算

实际影响:
- 简单任务开 thinking = 浪费 token（模型会"过度思考"）
- 复杂任务不开 thinking = 质量下降需要返工（总成本更高）
```

## 四、Sub-Agent 的成本陷阱与优化

### 源码揭示的关键机制

**Cache-safe params**：fork 子 agent 继承父进程的完整 system prompt，确保缓存命中：
```typescript
// forkSubagent.ts
type CacheSafeParams = {
  systemPrompt, userContext, systemContext, toolUseContext, forkContextMessages
}
// 存储在 module-level slot，保证子 agent 与父 agent 缓存一致
```

**策略 8: 多个子 agent 共享缓存**
```
发起 3 个并行子 agent:
- Agent A: 第一个启动，创建缓存 (cache_creation)
- Agent B: 5分钟内启动，命中缓存 (cache_read，1/10 价格)
- Agent C: 5分钟内启动，命中缓存

→ 并行子 agent 越多，缓存分摊效果越好
→ 但要确保在 5 分钟内全部启动
```

**策略 9: 子 agent 的 effort 控制**
```markdown
# 在调用 Agent 工具时
Agent({
  prompt: "...",
  model: "haiku",        # 用便宜模型
  # fork 模式下有独立 token 预算
})
```

## 五、速查：每个动作的 Token 成本估算

| 动作 | 估算 Token | 说明 |
|------|-----------|------|
| System prompt | ~2000-4000 | 首次创建，后续缓存 |
| 读取 100 行代码 | ~500-800 | 4 bytes/token |
| 读取一张图片 | 2000 (固定) | 源码硬编码 |
| Grep 搜索结果 | 200-2000 | 取决于匹配数 |
| Bash 命令输出 | 100-5000 | 取决于输出量 |
| 一次 tool_use 调用 | ~50-200 | name + JSON input |
| Thinking block | 变化大 | adaptive 模式下不可控 |
| /compact 操作 | ~1000-3000 | 总结旧内容的成本 |

**黄金法则**：每次 API 调用的成本 = input tokens (含缓存) + output tokens。input tokens 中缓存命中的部分只收 1/10。所以**保持缓存命中是最有效的省钱手段**。
