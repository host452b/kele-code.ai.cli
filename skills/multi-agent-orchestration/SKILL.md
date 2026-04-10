---
name: multi-agent-orchestration
description: 多 Agent 编排实战 — 基于 coordinator/swarm/team/worktree 源码逆向
user-invocable: true
---

# 多 Agent 编排实战指南

> 来源：AgentTool.tsx (1397行)、coordinatorMode.ts (368行)、teamHelpers.ts (21KB)、inProcessRunner.ts (53KB)、SendMessageTool.ts (917行)、worktree.ts (1180行) 逆向分析。

## 一、源码中的三种编排模式

### 模式 1: Ad-hoc 并行 Agent（最常用）

```
用户 → 一条消息中发起多个 Agent() 调用 → 并行执行 → 收结果
```

源码行为：
- 多个 Agent 调用在同一 turn 内并行启动
- 每个 agent 是独立的子进程/协程
- `run_in_background: true` 时异步执行，通过 task-notification 回报
- 默认同步执行（阻塞等待结果）

**适用场景**：2-5 个独立的搜索/分析/实现任务

### 模式 2: Coordinator 模式（大规模编排）

```bash
CLAUDE_COORDINATOR_MODE=true
```

源码中协调器的系统提示核心思想：
- 协调器负责**分解任务、分配工作、综合结果**
- Workers 负责**自主执行、研究、实现、验证**
- 所有 Agent 调用自动变异步
- 通过 task-notification XML 消息收集结果

**适用场景**：大型重构、多模块并行开发、需要反复迭代的复杂任务

### 模式 3: Team 模式（持久化团队）

```
TeamCreate("my-team") → 创建团队
Agent(name: "researcher", team_name: "my-team") → 加入团队
Agent(name: "implementer", team_name: "my-team") → 加入团队
SendMessage(to: "researcher", message: "...") → 团队内通信
SendMessage(to: "*", message: "...") → 广播
```

源码中的团队持久化在 `~/.claude/teams/<team-name>/config.json`，包含：
- 成员列表（agentId, name, model, worktreePath）
- Lead agent ID
- 后端类型（tmux / iTerm2 / in-process）

**适用场景**：需要长期协作的项目，成员需要持续通信

## 二、并行模式深度解析

### 关键发现：Cache-Safe Fork

源码中最精巧的设计之一：**fork 子 agent 复用父进程的 prompt cache**。

```typescript
// forkSubagent.ts
type CacheSafeParams = {
  systemPrompt,      // 与父进程完全相同
  userContext,        // 与父进程完全相同
  systemContext,      // 与父进程完全相同
  toolUseContext,     // 与父进程完全相同
  forkContextMessages // 父进程的消息快照
}
```

**实际效果**：
```
父进程第一次调用 API: cache_creation = 4000 tokens (全价)
Fork Agent A:          cache_read   = 4000 tokens (1/10 价格)
Fork Agent B:          cache_read   = 4000 tokens (1/10 价格)
Fork Agent C:          cache_read   = 4000 tokens (1/10 价格)

→ 3 个 fork agent 的 system prompt 成本 ≈ 父进程的 30%
```

**最佳实践**：在父进程中先做好 context 准备（读文件、搜索代码），然后一次性 fork 多个 agent。这样所有 fork 共享父进程的 cache。

### 关键发现：Worktree 复用

```typescript
// worktree.ts: createAgentWorktree()
// 如果 worktree 已存在 → 复用（只更新 mtime）
// 如果不存在 → git worktree add + symlink node_modules
```

**实际效果**：
- 首次创建 worktree: ~2-5 秒（git checkout + symlink）
- 后续复用: ~0.1 秒（只检查存在性）
- node_modules 通过 symlink 共享，不复制（省磁盘 + 省时间）

**清理策略**：
- Agent 无修改 → worktree 自动删除
- Agent 有修改 → 保留，返回路径和分支名
- 超过 30 天的 stale worktree → `cleanupStaleAgentWorktrees()` 自动清理

### 关键发现：Anti-Recursion Guard

```typescript
// forkSubagent.ts
export function isInForkChild(messages): boolean {
  return messages.some(m => m.content.includes('<fork-boilerplate>'))
}
```

Fork 子 agent 不能再次 fork（防止递归爆炸）。但普通 Agent 调用可以嵌套——agent 可以启动 agent，深度由 `maxTurns` 参数限制。

## 三、通信机制

### 同步通信（SendMessage）

```
Agent A → SendMessage(to: "Agent B", message: "请检查 src/auth.ts")
                                         ↓
                               Agent B 的消息队列
                                         ↓
                               Agent B 下次 tick 时处理
```

源码中的消息类型：
- 纯文本: `message: "string"`
- 结构化: `shutdown_request`, `shutdown_response`, `plan_approval_response`
- 广播: `to: "*"` 发给所有团队成员

### 异步通信（Mailbox）

源码中的邮箱机制（适用于 tmux/iTerm2 后端）：
```
写入: .claude/.teammate-mailbox/<agentId>/message-<timestamp>.json
读取: 领导 agent 轮询邮箱目录
```

**In-process 后端**直接写入 AppState 的 `pendingUserMessages` 队列。

### 权限同步

源码中最巧妙的设计之一：**权限冒泡**。

```
Worker Agent 需要权限 → 写入邮箱 permission_request
                           ↓
Leader Agent 读取邮箱 → 决定 approve/deny
                           ↓
写入 permission_response → Worker 继续执行
```

使用原子 check-and-claim 模式防止竞态条件。

## 四、实战编排模式

### 模式: 搜索-分析-实施三段式

```
# 阶段 1: 并行搜索（3 个 Explore agent）
Agent(subagent_type: "Explore", prompt: "找到所有 auth 相关的文件")
Agent(subagent_type: "Explore", prompt: "找到所有 API 路由定义")  
Agent(subagent_type: "Explore", prompt: "找到所有测试文件中的 auth 测试")
→ 并行执行，各自返回结果

# 阶段 2: 分析设计（1 个 Plan agent）
Agent(subagent_type: "Plan", prompt: """
基于以下搜索结果，设计重构方案:
- Auth 文件: {agent1_result}
- API 路由: {agent2_result}  
- 测试文件: {agent3_result}
""")
→ 返回重构方案

# 阶段 3: 并行实施（N 个 worktree agent）
Agent(prompt: "实施 auth 模块重构", isolation: "worktree")
Agent(prompt: "实施 API 路由重构", isolation: "worktree")
Agent(prompt: "更新测试", isolation: "worktree")
→ 各自在隔离环境实施，互不干扰
```

### 模式: 验证 Agent（质量门禁）

源码中发现的机制：当 agent 完成 3+ 个任务但没有触发验证时，系统会提示创建 verification agent。

```
Worker Agent 完成任务
    ↓
Verification Agent 检查:
  - 代码是否符合规范
  - 测试是否通过
  - 是否有安全问题
  - 性能是否退化
    ↓
通过 → 合并
失败 → 反馈给 Worker 修复
```

**源码中的规则**：*"only the verifier issues a verdict"* — Worker 不能自我验证。

### 模式: 增量交付流水线

```
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────┐
│ Feature  │ →  │  Test    │ →  │  Review  │ →  │Merge │
│ Agent    │    │  Agent   │    │  Agent   │    │      │
│(worktree)│    │(同worktree)│  │(readonly) │    │      │
└─────────┘    └──────────┘    └──────────┘    └──────┘
     ↑                                              │
     └──────────── 下一个 feature ←─────────────────┘
```

每个 feature 在独立 worktree 中：开发 → 测试 → 审查 → 合并。Pipeline 完成一个 feature 后自动开始下一个。

### 模式: 竞争方案选择

```
# 同一个任务启动 3 个不同方案的 agent
Agent(prompt: "用方案A实现: ...", isolation: "worktree", model: "sonnet")
Agent(prompt: "用方案B实现: ...", isolation: "worktree", model: "sonnet")
Agent(prompt: "用方案C实现: ...", isolation: "worktree", model: "sonnet")

# 收集结果后评审
Agent(subagent_type: "code-reviewer", prompt: """
评比三个方案的 worktree:
- 方案A: {worktree_a_path}
- 方案B: {worktree_b_path}
- 方案C: {worktree_c_path}
从代码质量、可维护性、性能角度打分
""")

# 选择最优方案合并
```

## 五、成本与性能权衡

| 编排模式 | 并行度 | 每次成本 | 适用规模 |
|----------|--------|---------|---------|
| 单 Agent | 1x | $0.05-0.5 | 单文件改动 |
| 2-3 并行 Agent | 2-3x | $0.1-1.0 | 多文件独立改动 |
| Coordinator + Workers | 3-10x | $0.5-5.0 | 跨模块重构 |
| Team 模式 | 3-10x | $1.0-10.0 | 长期项目迭代 |

**Cache 共享节省**：N 个 fork agent 的 system prompt 成本 ≈ 1 + 0.1*(N-1) 倍单个 agent。

## 六、常见陷阱

### 陷阱 1: 过度并行
```
BAD:  同时启动 20 个 agent → API rate limit (429/529)
GOOD: 批次执行，每批 3-5 个 agent
```
源码中 `MAX_529_RETRIES = 3`，连续 3 次 529 后切换备用模型。

### 陷阱 2: Worktree 冲突
```
BAD:  两个 agent 修改同一文件但在不同 worktree
      → 合并时冲突
GOOD: 按模块/文件分工，确保没有重叠
```

### 陷阱 3: 通信死锁
```
BAD:  Agent A 等待 Agent B 的消息，Agent B 等待 Agent A 的消息
GOOD: 使用单向通信模式：Leader 分配 → Workers 执行 → Workers 回报
```

### 陷阱 4: 上下文膨胀
```
BAD:  父 agent 收集 10 个子 agent 的完整输出 → 上下文爆炸
GOOD: 子 agent 返回摘要（源码中 task-notification 包含 summary 字段）
      或使用 /compact 压缩
```
