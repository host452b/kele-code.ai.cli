---
name: skill-testing-eval
description: Skill 测试、回归和 A/B 评估框架 — 基于 Claude Code 源码逆向工程总结
user-invocable: true
---

# Skill 测试与评估指南

> 来源：对 Claude Code SkillTool (1108行)、loadSkillsDir (1086行)、bundledSkills 等核心模块的逆向分析。

## 一、Anthropic 的真实验证体系：不是没有测试，而是测试范式不同

### 源码中可见的验证机制

源码中 skill 层面的验证确实有限：
- frontmatter 的 `HooksSchema().safeParse()` 校验 hooks 格式
- `findCommand()` 的名称/别名精确匹配
- `meetsAvailabilityRequirement()` 检查 feature gate
- Safe properties allowlist 决定是否免权限

表面上看**没有**传统意义上的单元测试、集成测试框架。但这个结论需要辩证来看。

### Boris Cherny（Claude Code 创始人）公开披露的验证体系

从泄露代码和 Boris 的公开分享来看，Anthropic 的工程验证其实是多层次的，只是和传统单元测试思路完全不同：

**1. CLAUDE.md 作为"活的回归规则库"**

团队共享一个 CLAUDE.md 文件，签入 git，全团队每周贡献多次。每当发现 Claude 做错了什么，就加到 CLAUDE.md 里，让 Claude 下次不再犯同样的错。

这本质上是把回归测试变成了**规则积累**——不是测某个函数的输出，而是约束 AI agent 的行为边界。源码验证了这一点：`getUserContext()` 在每次会话启动时加载 CLAUDE.md 到 system context，并参与 prompt cache。

```
传统回归测试:  assert(fn(input) === expectedOutput)
CLAUDE.md 回归: "当遇到 X 场景时，永远不要做 Y，因为上次做了导致 Z"
```

**2. 可观测性优先于传统测试**

Boris 在访谈中解释了为什么代码本身不是最重要的——Anthropic 在构建的不只是写代码的系统，还有**监控代码变更效果的可观测性系统**。思路是：与其逐行写单测，不如建一套系统能在问题发生时自动发现并回滚。

源码中的证据：
- `logForDiagnosticsNoPII()` 遍布关键路径，零 PII 的结构化日志
- `tengu_skill_tool_invocation` 遥测事件记录每次 skill 调用的详细数据
- GrowthBook feature flags 支持灰度发布 + 快速回滚
- 启动性能采样（0.5% 外部用户 + 100% 内部）

**3. "VerifyApp" 子代理做端到端验证**

Boris 常用的子代理之一叫 VerifyApp，包含详细的端到端测试指令，专门测试 Claude Code 本身。源码中也有对应机制：
- `TaskUpdateTool` 中的 verification agent nudge：完成 3+ 个任务但没有验证时，系统提示创建 verification agent
- 源码注释：*"only the verifier issues a verdict"*——Worker 不能自我验证
- `TaskCompleted` hooks 可以阻止标记完成，充当质量门禁

此外，Claude Code 团队用 Chrome 扩展来测试 claude.ai/code 上的每一个改动——打开浏览器、测试 UI、反复迭代直到代码和体验都没问题。

**4. Post-tool-use Hook 做格式守卫**

团队用 `PostToolUse` hook 在 Claude 编辑代码后自动格式化。Claude 通常生成的代码格式已经不错，hook 处理最后 10% 以避免 CI 中的格式错误。

源码验证：hooks.ts (159KB) 实现了完整的 `PreToolUse` / `PostToolUse` / `PostToolUseFailure` 生命周期。

### 总结：验证范式的转变

```
传统软件验证:
  单元测试 → 集成测试 → E2E 测试 → 人工 QA

AI Agent 验证 (Anthropic 模式):
  CLAUDE.md 规则约束     → 行为边界回归
  + 可观测性 + 灰度发布  → 问题自动发现 + 快速回滚
  + AI 子代理端到端验证   → VerifyApp / verification agent
  + CI Hook 格式守卫     → PostToolUse 自动修正
```

**不是"没有验证"，而是验证方式从"写测试断言"转向了"规则约束 + 可观测性 + AI 子代理验证 + CI hook"的组合。**

那么对于我们自己的 skill 工程，该怎么做？下面的体系融合了两种思路。

## 二、实战 Skill 验证体系（融合 Anthropic 模式 + 传统测试）

### Layer 0: CLAUDE.md 规则积累（Anthropic 核心模式，零边际成本）

这是 Anthropic 团队最依赖的验证方式。每次 skill 产生了不好的结果，不是去写测试用例，而是在 CLAUDE.md 中加一条规则：

```markdown
# CLAUDE.md (项目级)

## Skill 行为约束（团队共建，持续积累）

### /refactor skill
- 不要重命名已导出的公共 API（破坏下游消费者）
- 不要把多个小函数合并成一个大函数（违反单一职责）
- 重构后必须运行 npm test，不通过则回滚

### /code-review skill  
- 不要给出"looks good"式的空洞评价
- 必须检查：错误处理、边界条件、类型安全
- 对 any 类型使用必须提出替代方案

### /fix-bug skill
- 先写测试复现 bug，再修复
- 修复范围不超过 bug 直接相关的代码
- 不要顺手重构"看起来不好"的周边代码
```

**为什么这有效**：
- CLAUDE.md 在每次会话启动时加载到 system prompt，参与 prompt cache
- 规则是**增量积累**的——团队每个人都可以贡献
- 本质是用自然语言描述的**行为回归测试**
- 零额外成本（不需要跑测试，规则在每次调用时自动生效）

### Layer 0.5: PostToolUse Hook 自动守卫（CI 级别）

```json
// ~/.claude/settings.json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "command": "npx prettier --write $TOOL_OUTPUT_PATH 2>/dev/null; npx eslint --fix $TOOL_OUTPUT_PATH 2>/dev/null || true"
      }
    ],
    "TaskCompleted": [
      {
        "command": "bash -c 'npm test --silent || echo {\"blockingError\": \"Tests failed, cannot mark complete\"}'"
      }
    ]
  }
}
```

**效果**：
- 每次 Edit/Write 后自动格式化（处理 Claude 输出的最后 10% 格式问题）
- TaskCompleted hook 阻止在测试失败时标记任务完成（质量门禁）

## 三、Skill 测试四层体系

### Layer 1: 静态校验（零成本）

```bash
# 检查 frontmatter 格式是否合法
cat skills/my-skill/SKILL.md | head -20
# 必须有 --- 开头和结尾的 YAML frontmatter
# name, description 字段必须存在

# 检查参数替换变量是否都被使用
grep -c '\$ARG[0-9]' skills/my-skill/SKILL.md
# 对比 arguments 字段声明的数量

# 检查 allowed-tools 中的工具名是否存在
# 合法工具名: Bash, Read, Edit, Write, Glob, Grep, Agent, WebFetch, WebSearch 等
```

**自动化脚本**（建议加到 CI）：
```bash
#!/bin/bash
# validate-skills.sh
for skill_dir in skills/*/; do
  md="$skill_dir/SKILL.md"
  [ -f "$md" ] || continue
  
  # 检查 frontmatter 存在
  head -1 "$md" | grep -q '^---' || echo "FAIL: $md missing frontmatter"
  
  # 检查 name 字段
  grep -q '^name:' "$md" || echo "WARN: $md missing name field"
  
  # 检查 description 字段
  grep -q '^description:' "$md" || echo "WARN: $md missing description"
  
  # 检查未闭合的代码块
  count=$(grep -c '```' "$md")
  [ $((count % 2)) -eq 0 ] || echo "FAIL: $md has unclosed code block"
done
```

### Layer 2: 沙盒执行测试（低成本）

利用 Claude Code 的 `context: fork` 特性，skill 在子 agent 中执行，天然隔离。

**测试策略**：
```markdown
---
name: test-runner
description: 在 fork 上下文中测试指定 skill
context: fork
allowed-tools: Bash, Read, Glob, Grep
---

执行以下测试流程：
1. 调用 /{{skill_name}} {{test_args}}
2. 检查输出是否包含预期关键词
3. 检查是否有错误或异常
4. 输出 PASS/FAIL 及原因
```

**关键洞察**：fork 模式下子 agent 有独立 token 预算，不影响主会话。源码中 `prepareForkedCommandContext()` 会完整复制 skill 内容到隔离环境。

### Layer 3: 对比评估（A/B 测试）

**原理**：同一个任务用不同 skill 执行，对比结果质量。

```bash
# 测试用例文件: test-cases.jsonl
{"task": "重构这个函数使其更可读", "file": "src/example.ts", "expected_traits": ["变量名更清晰", "函数更短", "无功能变更"]}
{"task": "修复这个 bug", "file": "src/buggy.ts", "expected_traits": ["测试通过", "最小改动"]}
```

**评估 skill**：
```markdown
---
name: skill-eval
description: A/B 评估两个 skill 的效果差异
context: fork
---

## 评估流程

对于每个测试用例：

1. **基线组**：用 Skill A 执行任务，记录:
   - 输出质量（0-10）
   - token 消耗
   - 执行时间
   - 是否达成 expected_traits

2. **实验组**：用 Skill B 执行相同任务，记录同样指标

3. **对比报告**：
   - 质量差异
   - 成本差异
   - 速度差异
   - 各项 trait 达成率

使用 git worktree 隔离每次执行（源码中 createAgentWorktree 支持最大64字符 slug）。
```

### Layer 4: 回归测试（金标准对比）

**核心思路**：保存"已知好的"输出作为 golden file，后续改动后对比。

```
skills/my-skill/
├── SKILL.md
├── tests/
│   ├── case-01/
│   │   ├── input.md        # 输入 prompt
│   │   ├── golden.md       # 期望输出的关键特征
│   │   └── config.json     # {"model": "opus", "max_turns": 5}
│   └── case-02/
│       ├── input.md
│       └── golden.md
```

**回归检查 skill**：
```markdown
---
name: skill-regression
description: 对比 skill 输出与 golden file 的差异
context: fork
allowed-tools: Bash, Read, Glob, Grep, Agent
---

对于 tests/ 目录下的每个 case：
1. 读取 input.md 作为任务输入
2. 执行目标 skill
3. 读取 golden.md 中的期望特征（关键词、模式、约束）
4. 逐项检查输出是否满足
5. 汇总 PASS/FAIL 报告

注意：不要求逐字匹配，而是检查语义特征是否满足。
这是因为 LLM 输出不确定性——同一个 skill 两次执行结果不会完全相同。
```

## 四、降低测试成本的技巧（来自源码洞察）

1. **用 haiku 做初筛**：skill frontmatter 支持 `model: haiku`，测试时先用便宜模型跑通流程，确认无结构性问题后再用 opus 做质量评估

2. **限制 effort**：`effort: low` 减少 token 预算，适合测试 skill 的结构而非内容质量

3. **利用 prompt caching**：源码显示 cache_control 有 5 分钟 TTL。连续测试同一 skill 的多个 case 时，system prompt 会被缓存，后续调用成本降低 ~90%（cache read 比 cache creation 便宜得多）

4. **fork 而非 inline**：fork 模式下 token 预算独立，不会撑爆主会话的上下文窗口

5. **rough estimation 预检**：源码中 `roughTokenCountEstimation` 用 4 bytes/token 估算。测试前先估算 skill 内容 + 测试用例的总 token，避免超预算

## 五、Skill 质量评分维度

| 维度 | 权重 | 检查方式 |
|------|------|----------|
| 任务完成度 | 40% | expected_traits 达成率 |
| 最小改动原则 | 20% | git diff 行数 / 文件数 |
| 无副作用 | 15% | 测试是否仍然通过 |
| Token 效率 | 15% | 完成任务的 token 消耗 |
| 可复现性 | 10% | 多次执行结果一致性 |
