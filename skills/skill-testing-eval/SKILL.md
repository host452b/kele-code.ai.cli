---
name: skill-testing-eval
description: Skill 测试、回归和 A/B 评估框架 — 基于 Claude Code 源码逆向工程总结
user-invocable: true
---

# Skill 测试与评估指南

> 来源：对 Claude Code SkillTool (1108行)、loadSkillsDir (1086行)、bundledSkills 等核心模块的逆向分析。

## 一、核心发现：Claude Code 没有内置 Skill 测试框架

源码中 skill 的"测试"仅限于：
- frontmatter 的 `HooksSchema().safeParse()` 校验 hooks 格式
- `findCommand()` 的名称/别名精确匹配
- `meetsAvailabilityRequirement()` 检查 feature gate
- Safe properties allowlist 决定是否免权限

**没有**：单元测试、集成测试、回归测试、效果评估。这意味着你必须自建。

## 二、Skill 测试四层体系

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

## 三、降低测试成本的技巧（来自源码洞察）

1. **用 haiku 做初筛**：skill frontmatter 支持 `model: haiku`，测试时先用便宜模型跑通流程，确认无结构性问题后再用 opus 做质量评估

2. **限制 effort**：`effort: low` 减少 token 预算，适合测试 skill 的结构而非内容质量

3. **利用 prompt caching**：源码显示 cache_control 有 5 分钟 TTL。连续测试同一 skill 的多个 case 时，system prompt 会被缓存，后续调用成本降低 ~90%（cache read 比 cache creation 便宜得多）

4. **fork 而非 inline**：fork 模式下 token 预算独立，不会撑爆主会话的上下文窗口

5. **rough estimation 预检**：源码中 `roughTokenCountEstimation` 用 4 bytes/token 估算。测试前先估算 skill 内容 + 测试用例的总 token，避免超预算

## 四、Skill 质量评分维度

| 维度 | 权重 | 检查方式 |
|------|------|----------|
| 任务完成度 | 40% | expected_traits 达成率 |
| 最小改动原则 | 20% | git diff 行数 / 文件数 |
| 无副作用 | 15% | 测试是否仍然通过 |
| Token 效率 | 15% | 完成任务的 token 消耗 |
| 可复现性 | 10% | 多次执行结果一致性 |
