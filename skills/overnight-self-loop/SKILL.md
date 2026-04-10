---
name: overnight-self-loop
description: AI Agent 自举循环与自我迭代 — 基于 proactive/cron/daemon/coordinator 源码逆向
user-invocable: true
---

# 让 AI Agent 跑一晚上自我迭代

> 来源：proactive mode (print.ts)、cronScheduler.ts (470行)、coordinatorMode.ts (368行)、AgentTool (1397行)、TaskSystem、SleepTool 逆向分析。

## 一、源码中的自举基础设施

### 三个核心机制

**1. Proactive Mode（主动模式）**
```bash
claude --proactive  # 或 CLAUDE_PROACTIVE=true
```

源码中的行为：
- 每次 agent 回合结束后，自动注入 `<tick>HH:MM:SS</tick>` 消息
- agent 看到 tick 后可以决定：继续工作 or SleepTool 等待
- 用户随时可以打断（高优先级 stdin 抢占 tick）
- 系统提示追加：*"You are in proactive mode. Take initiative — explore, act, and make progress without waiting for instructions."*

**2. Cron Scheduler（定时调度）**
```
CronTask = {
  cron: "*/30 * * * *"   # 每30分钟
  prompt: "检查测试状态并修复失败的测试"
  recurring: true         # 重复执行
  durable: true          # 持久化到磁盘
  permanent: true        # 不过期
}
```

源码中调度器每 1 秒检查一次（CHECK_INTERVAL_MS = 1000），触发时将 prompt 推入命令队列。

**3. Coordinator Mode（协调器模式）**
```bash
CLAUDE_COORDINATOR_MODE=true claude
```

源码中系统提示的核心指令：
*"Parallelism is your superpower. Workers are async. Launch independent workers concurrently whenever possible."*

协调器自动将所有 Agent 调用变成异步，通过 task-notification XML 消息收集结果。

## 二、自举循环架构

### 方案 A: Proactive + CLAUDE.md 驱动（最简单）

```
                    ┌─────────────────────┐
                    │  Agent (proactive)   │
                    │                     │
            ┌───── │  1. 读取 GOALS.md    │ ─────┐
            │      │  2. 读取当前状态      │      │
            │      │  3. 决定下一步        │      │
            │      │  4. 执行             │      │
            │      │  5. 更新 GOALS.md    │      │
            │      │  6. Sleep 等待下轮    │      │
            │      └─────────────────────┘      │
            │              ↑ tick               │
            └──────────────┘                    │
                                               │
            用户醒来后读 GOALS.md 查看进度 ←──────┘
```

**配置步骤**：

第 1 步：创建 GOALS.md（agent 的大脑）

```markdown
# Project Goals

## Vision
构建一个高性能的 REST API 服务，支持用户认证、数据 CRUD、实时通知。

## Current Sprint
- [x] 项目初始化
- [ ] 用户认证模块
- [ ] 数据模型设计
- [ ] API 端点实现
- [ ] 测试覆盖 > 80%

## Constraints
- 使用 TypeScript strict mode
- 所有 API 必须有 OpenAPI spec
- 每个功能必须有测试
- 不要一次改太多文件（每轮最多 5 个）

## Community Reference (同类产品常见 feature)
- JWT + refresh token 认证
- Rate limiting
- Request validation (Zod)
- Structured logging (pino)
- Graceful shutdown
- Health check endpoint
- API versioning

## What I Learned (agent 自己写)
<!-- agent 在每轮迭代后更新这里 -->
```

第 2 步：创建驱动 Skill

```markdown
# skills/self-iterate/SKILL.md
---
name: self-iterate
description: 读取 GOALS.md 执行下一个未完成任务并更新进度
context: fork
---

## 自我迭代流程

1. 读取 GOALS.md 中的 Current Sprint
2. 找到第一个未完成的任务 ([ ])
3. 分析任务需求，制定实施计划
4. 在 worktree 中实施（安全隔离）
5. 运行测试验证
6. 如果测试通过：
   - 将改动合并回主分支
   - 在 GOALS.md 中标记为 [x]
   - 在 What I Learned 中记录心得
7. 如果测试失败：
   - 在 GOALS.md 中记录失败原因
   - 标记为 [!] 需要人工介入
8. 检查 Constraints 确保未违反任何约束
```

第 3 步：配置 CLAUDE.md

```markdown
# CLAUDE.md

你正在自主迭代模式下工作。

## 工作规则
1. 每轮只做一个任务
2. 完成后更新 GOALS.md
3. 遇到不确定的设计决策时，在 GOALS.md 的 Questions 部分记录，不要自行决定
4. 每轮结束后 Sleep 120 秒（保持 prompt cache 活跃，TTL=5分钟）
5. 如果连续 3 次失败，停止并在 GOALS.md 中写明问题

## 质量门槛
- 所有代码必须通过 lint
- 所有新功能必须有测试
- 不修改已有测试（除非修 bug）

## 执行方式
每次 tick 到来时：
1. /self-iterate
2. 如果所有任务完成，输出 "ALL DONE" 并停止
```

第 4 步：启动

```bash
# Token 预算充足时
claude --proactive

# 或使用 cron 模式（更可控）
# 在 claude 中执行:
/loop 5m /self-iterate
```

### 方案 B: Coordinator + 多 Agent 并行（高效但高成本）

```
        ┌─────────────────────────┐
        │    Coordinator Agent     │
        │  (读取 GOALS.md, 分配)   │
        └─────┬──────┬──────┬─────┘
              │      │      │
        ┌─────┴─┐ ┌──┴──┐ ┌┴──────┐
        │Worker1│ │Work2│ │Worker3│
        │认证模块│ │数据层│ │API端点│
        │(worktree)│(worktree)│(worktree)│
        └───┬───┘ └──┬──┘ └───┬───┘
            │        │        │
            └────────┼────────┘
                     │
        ┌────────────┴────────────┐
        │   Coordinator 收集结果   │
        │   Review + Merge        │
        │   更新 GOALS.md         │
        │   启动下一批 Workers     │
        └─────────────────────────┘
```

**关键配置**：
```bash
CLAUDE_COORDINATOR_MODE=true claude --proactive
```

### 方案 C: Cron 定时巡检模式（最省 Token）

不让 agent 持续运行，而是定时唤醒：

```
每 30 分钟:
  1. 读取项目状态
  2. 运行测试
  3. 如果有失败 → 修复
  4. 如果全部通过 → 做下一个 feature
  5. 更新 GOALS.md
  6. 退出（释放 token 预算）
```

源码中的 cron 配置：
```javascript
CronTask({
  cron: "*/30 * * * *",     // 每 30 分钟
  prompt: "/self-iterate",   // 执行自迭代 skill
  recurring: true,
  durable: true,             // 持久化，重启后恢复
  permanent: true            // 永不过期
})
```

## 三、关键技巧：让 Agent 理解你的想法

### 技巧 1: GOALS.md 三层结构

```markdown
# Layer 1: Vision（不变的方向）
构建什么，为什么，给谁用

# Layer 2: Sprint（当前批次的任务）
具体的、可执行的任务列表
每个任务有明确的完成标准

# Layer 3: Learned（agent 自己积累的知识）
遇到的问题、做出的决策、发现的模式
→ 这层由 agent 自己维护，是"自我进化"的核心
```

### 技巧 2: 社区 Feature Spec 注入

在 GOALS.md 或 CLAUDE.md 中写入同类产品的常见 feature list：

```markdown
## Community Best Practices (来自同类开源项目)
- 参考: express-typescript-boilerplate, fastify-starter, nestjs-starter
- 常见功能清单:
  - [ ] 结构化日志 (pino/winston)
  - [ ] 请求 ID 追踪 (correlation ID)
  - [ ] 优雅关闭 (graceful shutdown)
  - [ ] 健康检查 (/health, /ready)
  - [ ] OpenAPI 文档自动生成
  - [ ] Docker multi-stage build
  - [ ] CI/CD pipeline (GitHub Actions)
  - [ ] 数据库 migration 系统
  - [ ] 缓存层 (Redis)
  - [ ] 消息队列集成
```

agent 会参考这个列表来评估自己的实现是否完整。

### 技巧 3: 安全制动机制

```markdown
## Emergency Stop Conditions (CLAUDE.md)
如果出现以下任何情况，立即停止并在 GOALS.md 写入 EMERGENCY STOP：
1. 测试连续失败 3 次以上
2. 出现数据丢失风险
3. 代码变更超过 500 行（可能是方向错误）
4. 不确定是否应该删除现有功能
5. 需要改动基础设施配置
```

### 技巧 4: Sleep 时间的科学

源码揭示的关键约束：
```
Prompt cache TTL = 5 minutes
→ Sleep > 5min = 缓存失效 = 下次调用 token 成本翻倍
→ Sleep < 2min = 频繁调用 = 浪费 token 在"无事可做"的回合
→ 最佳 Sleep = 2-4 minutes
```

SleepTool 的源码提示写道：*"Each wake-up costs an API call, but prompt cache expires after 5 minutes of inactivity — balance accordingly"*

### 技巧 5: 利用 Task 系统追踪进度

```
# Agent 在每轮开始时:
TaskList → 查看当前任务状态
TaskUpdate(taskId, status: "in_progress") → 标记开始

# Agent 在每轮结束时:
TaskUpdate(taskId, status: "completed") → 标记完成
TaskCreate(nextTask) → 创建下一个任务
```

源码中的巧妙设计：`TaskCompleted` hook 可以触发外部通知（比如发到 Slack），让你醒来后知道进度。

## 四、成本估算

### 一晚上（8小时）的 Token 消耗估算

| 模式 | 频率 | 每轮 Token | 8h 总量 | 估算成本 (Opus) |
|------|------|-----------|---------|----------------|
| Proactive (2min间隔) | 240 轮 | ~5000 | ~1.2M | ~$36 |
| Proactive (4min间隔) | 120 轮 | ~5000 | ~600K | ~$18 |
| Cron (30min间隔) | 16 轮 | ~10000 | ~160K | ~$5 |
| Coordinator + 3 workers | 30 批 | ~20000 | ~600K | ~$18 |

**缓存命中的节省**：如果 cache hit rate 达到 80%，input token 成本降低约 72%。

### 优化建议
```
低预算: Cron 30min + Sonnet → 最便宜，每晚 ~$2
中预算: Proactive 4min + Sonnet → 平衡，每晚 ~$8  
高预算: Coordinator + Opus → 最高质量，每晚 ~$18-36
```

## 五、启动检查清单

```
准备阶段:
[ ] GOALS.md 写好 Vision + Sprint + Constraints
[ ] CLAUDE.md 写好工作规则 + 安全制动条件
[ ] self-iterate skill 已创建并测试通过
[ ] permissions deny 规则已配置（防止危险操作）
[ ] git 在干净状态（所有变更已提交）

启动:
[ ] 确认 token 预算充足
[ ] claude --proactive 或配置 cron
[ ] 观察前 2-3 轮确认行为正常

早上检查:
[ ] 读 GOALS.md 查看进度
[ ] git log 查看提交历史
[ ] npm test 确认测试通过
[ ] 查看 EMERGENCY STOP 是否触发
```
