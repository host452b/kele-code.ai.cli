---
name: agent-power-user
description: AI Agent 高效使用术与隐藏技巧 — 基于源码逆向工程发现的秘密机制
user-invocable: true
---

# AI Agent 高效使用术

> 来源：对 SkillTool、AgentTool、proxy、QueryEngine、permissions 等核心模块的逆向分析，提炼出官方文档从未提及的高级用法。

## 一、Skill 系统的隐藏力量

### 秘密 1: Skill 就是注入到对话中的 User Message

源码真相：当你调用一个 skill 时，SkillTool 做的事情是：
1. 读取 SKILL.md 内容
2. 剥掉 YAML frontmatter
3. 在前面加上 `Base directory for this skill: <path>`
4. 作为 **user message** 注入到对话中

这意味着：**skill 本质上就是一段精心编写的 prompt**。你可以把任何复杂的工作流程、决策树、检查清单写成 skill，agent 会像收到用户指令一样执行它。

### 秘密 2: `allowed-tools` 是一个强力约束

```yaml
---
name: safe-reviewer
allowed-tools: Read, Glob, Grep
---
# 这个 skill 只能读代码，不能修改任何文件
```

源码中 SkillTool 的 `contextModifier` 会把 `allowedTools` 注入到 `alwaysAllowRules.command` 中。这意味着：
- 限制工具 = 限制 agent 的行为边界
- 审查类 skill 用 Read-only 工具，防止误改
- 生成类 skill 可以开放 Write/Edit

### 秘密 3: `context: fork` 的真正含义

fork 不是简单的"新开一个窗口"，而是：
- 独立的 token 预算（不占用主会话额度）
- 独立的 abort controller（可以单独取消）
- 继承父进程的 cache-safe params（缓存命中）
- 执行完后结果以文本形式返回（不是消息流）

**用途**：把高风险/高消耗的操作放在 fork 里，失败了不影响主会话。

### 秘密 4: 条件 Skill（paths 字段）

```yaml
---
name: react-patterns
paths: "src/components/**/*.tsx"
---
```

只有当你在对话中触及了匹配路径的文件时，这个 skill 才会出现在可用列表中。源码中 `activateConditionalSkillsForPaths()` 使用 gitignore 风格的模式匹配。

**应用场景**：
- 前端文件的 skill 只在碰前端代码时出现
- 数据库 migration 的 skill 只在碰 schema 文件时出现
- 减少 skill 列表噪音（skill 列表只有 1% 上下文窗口的预算）

### 秘密 5: Skill 中的变量替换

```yaml
---
arguments: ["target_file", "refactor_type"]
---

请对 $ARG1 进行 $ARG2 类型的重构。
```

调用：`/my-skill src/main.ts extract-method`

源码中 `substituteArguments()` 做简单的字符串替换。但更强的用法是在 skill 内容中使用：
- `${CLAUDE_SKILL_DIR}` — skill 所在目录的绝对路径
- `${CLAUDE_SESSION_ID}` — 当前会话 ID

## 二、Agent 工具的高级技巧

### 技巧 1: 并行 Agent 是性能倍增器

源码中协调器模式的系统提示明确写道：*"Parallelism is your superpower. Workers are async. Launch independent workers concurrently whenever possible."*

```
一条消息中发起多个 Agent 调用 = 真正的并行执行

BAD:
  Agent("做任务A") → 等结果 → Agent("做任务B") → 等结果

GOOD:
  同时发起: Agent("做任务A") + Agent("做任务B") + Agent("做任务C")
  → 三个都在后台跑，通过 task-notification 收结果
```

### 技巧 2: Worktree 隔离 = 无风险实验

```
Agent({
  prompt: "尝试重构整个模块",
  isolation: "worktree"    # 在 git worktree 里操作
})
```

源码中的行为：
- `createAgentWorktree()` 在 `.claude/worktrees/agent-<8hex>/` 创建隔离副本
- node_modules 等大目录通过 symlink 共享（不复制）
- 如果 agent 没有做任何修改，worktree 自动清理
- 如果有修改，返回 worktree 路径和分支名，你可以选择合并或丢弃

**杀手级用法**：让 agent 在 worktree 里做高风险重构，review 后决定是否合并。

### 技巧 3: 子 Agent 的 subagent_type 选择

源码中预定义的 agent 类型，每种有不同的系统提示和工具集：
- `general-purpose` — 通用，所有工具
- `Explore` — 快速代码搜索，只读工具
- `Plan` — 架构设计，不能编辑文件
- `code-reviewer` — 代码审查

**选择策略**：
```
搜索/理解代码 → Explore (快，只读，不会误改)
设计方案     → Plan (只思考，不动手)
写代码       → general-purpose (完整工具集)
审查代码     → code-reviewer (有特定审查 prompt)
```

### 技巧 4: SendMessage 继续已完成的 Agent

```
# Agent "researcher" 完成后，可以追加指令
SendMessage(to: "researcher", message: "基于你的发现，再深入分析 X")
```

源码中 SendMessage 可以恢复已完成的 agent，保留完整上下文。这比重新启动一个 agent 便宜得多（缓存命中 + 已有上下文）。

## 三、权限系统的巧用

### 技巧 5: 自定义 allow/deny 规则避免反复确认

```json
// ~/.claude/settings.json
{
  "permissions": {
    "allow": [
      "Read",
      "Glob",
      "Grep",
      "Bash(git status)",
      "Bash(git diff *)",
      "Bash(npm test)",
      "Bash(npm run lint)",
      "Edit(src/**)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push *)",
      "Bash(curl *)"
    ]
  }
}
```

源码中的匹配逻辑使用 gitignore 风格模式：
- `Bash(git *)` 匹配所有 git 开头的命令
- `Edit(src/**)` 匹配 src 下所有文件的编辑
- deny 规则 **优先于** allow 规则

### 技巧 6: Hooks 实现自动化工作流

```json
// ~/.claude/settings.json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Edit",
      "command": "echo '{\"decision\": \"approve\"}'"
    }],
    "PostToolUse": [{
      "matcher": "Bash",
      "command": "bash -c 'if echo \"$TOOL_INPUT\" | grep -q \"npm test\"; then echo \"Tests executed\"; fi'"
    }],
    "TaskCompleted": [{
      "command": "notify-send 'Task Done' \"$TASK_SUBJECT\""
    }]
  }
}
```

源码中 hooks 的执行超时：正常 10 分钟，SessionEnd 仅 1.5 秒。

## 四、上下文管理的艺术

### 技巧 7: CLAUDE.md 是最强的持久化 prompt

CLAUDE.md 在每次会话开始时被加载到 system context 中，并且**参与 prompt cache**。这意味着：
- 写在 CLAUDE.md 里的指令 = 几乎免费的持久化 prompt（缓存命中后）
- 项目级 `.claude/CLAUDE.md` + 用户级 `~/.claude/CLAUDE.md` 都会加载
- CLAUDE.md 改变 = 缓存失效，所以不要频繁改动

**最佳内容**：
```markdown
# CLAUDE.md
## 项目约定
- 使用 TypeScript strict mode
- 测试框架: vitest
- 代码风格: 函数式优先

## 常用命令
- `npm test` 跑测试
- `npm run lint` 检查风格
- `npm run build` 构建

## 禁止事项
- 不要修改 .env 文件
- 不要直接 push 到 main
- 不要删除测试文件
```

### 技巧 8: Memory 系统的正确用法

源码中 agent memory 有三个作用域：
- **User scope**: `~/.claude/agent-memory/<agentType>/` — 跨项目持久化
- **Project scope**: `.claude/agent-memory/<agentType>/` — 项目级
- **Local scope**: `.claude/agent-memory-local/<agentType>/` — 本机级

入口文件是 `MEMORY.md`，通过 `loadAgentMemoryPrompt()` 加载到 agent 的系统提示中。

**用途**：让特定类型的子 agent（如 Explore、code-reviewer）记住项目特有的模式和约定。

### 技巧 9: 利用 Deferred Tools 减少 token 开销

源码中 tool schema 占用的 token：所有 tools 的 JSON schema 加起来可能达 5000-10000 tokens。

Deferred tools（延迟加载工具）机制：
- 启动时只注册工具名称（几个 token）
- agent 需要时通过 ToolSearch 获取完整 schema
- 减少每次 API 调用的 input token

**启示**：如果你自定义了很多 MCP tools，考虑哪些需要常驻，哪些可以延迟加载。

## 五、实战 Workflow 模板

### 模板: 高效代码审查

```
1. Agent(Explore) — 并行搜索相关文件
2. Agent(Plan) — 基于搜索结果设计方案  
3. Agent(general-purpose, isolation: worktree) — 在隔离环境实施
4. Agent(code-reviewer) — 审查变更
5. 人工确认 → 合并 worktree
```

### 模板: 大规模重构

```
1. 用 Explore agent 扫描所有需要改动的文件
2. 用 Plan agent 制定重构方案
3. 并行启动 N 个 worktree agents，每个负责一个模块
4. 收集所有 agent 结果，逐个 review
5. 合并通过审查的 worktree
```
