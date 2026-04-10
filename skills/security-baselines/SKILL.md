---
name: security-baselines
description: AI Agent 安全底线保障清单 — 基于 Claude Code 权限/沙盒/注入防护源码逆向
user-invocable: true
---

# AI Agent 安全底线保障

> 来源：permissions.ts、dangerousPatterns.ts、filesystem.ts (62KB)、sandbox-adapter.ts (35KB)、hooks.ts (159KB)、sanitization.ts、subprocessEnv.ts 逆向分析。

## 一、安全架构总览（源码中的三层防御）

```
Layer 1: Input Validation    ← validateInput() 每个工具调用前
Layer 2: Permission Check    ← hasPermissionsToUseTool() 多源决策
Layer 3: Sandbox Execution   ← 文件系统/网络隔离
```

这三层任何一层拦截都会阻止操作。源码中 deny 规则**始终优先于** allow 规则。

## 二、必须配置的安全规则

### 规则 1: Deny 高危命令（不可协商）

```json
// ~/.claude/settings.json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf *)",
      "Bash(sudo *)",
      "Bash(curl * | sh)",
      "Bash(curl * | bash)",
      "Bash(wget * | sh)",
      "Bash(eval *)",
      "Bash(exec *)",
      "Bash(ssh *)",
      "Bash(git push --force *)",
      "Bash(git reset --hard *)",
      "Bash(DROP TABLE *)",
      "Bash(kubectl delete *)",
      "Bash(docker rm -f *)",
      "Edit(.env*)",
      "Edit(.git/config)",
      "Edit(~/.ssh/*)",
      "Write(.env*)",
      "Write(~/.ssh/*)"
    ]
  }
}
```

源码中 `dangerousPatterns.ts` 列出的高危工具（auto-mode 下自动阻止）：
- 跨平台解释器：python, node, ruby, perl, php, lua
- 包管理执行：npx, bunx, npm run, yarn run
- 系统级工具：eval, exec, env, xargs, sudo
- 网络工具：curl, wget
- 云工具：kubectl, aws, gcloud
- VCS：git (整体), gh api

### 规则 2: 文件系统保护

源码中 `filesystem.ts` 保护的关键文件：
```
.gitconfig, .gitmodules
.bashrc, .bash_profile, .zshrc, .zprofile, .profile
.ripgreprc
.mcp.json, .claude.json (settings)
.git/ 目录 (整体)
.vscode/, .idea/ (IDE 配置)
.claude/ 目录 (agent 配置)
```

**你还应该保护**：
```json
{
  "permissions": {
    "deny": [
      "Edit(credentials*)",
      "Edit(*.pem)",
      "Edit(*.key)",
      "Edit(*secret*)",
      "Edit(docker-compose.prod*)",
      "Edit(k8s/production/*)",
      "Write(credentials*)",
      "Write(*.pem)",
      "Read(*.pem)",
      "Read(*secret*)"
    ]
  }
}
```

### 规则 3: 路径遍历防护

源码中的防护措施：
- 绝对路径展开 + 规范化
- Symlink 解析（防止通过符号链接逃逸）
- 路径遍历检测 `containsPathTraversal()`
- Windows UNC 路径漏洞检测
- **Case-insensitive 规范化**（macOS/Windows 上 `.Claude/` 和 `.claude/` 是同一路径）

**你需要知道**：agent 可能通过构造路径来绕过规则：
```
BAD:  /home/user/../../../etc/passwd   → 路径遍历
BAD:  /home/user/.CLAUDE/settings.json → 大小写绕过
```
源码已处理这些，但自定义规则中也要注意用规范化路径。

## 三、注入攻击防护

### 防护 1: Unicode 注入

源码中 `sanitization.ts` 防护的攻击向量：
- Unicode tag characters（不可见字符，可以携带隐藏指令）
- Format control characters（改变文本方向）
- Zero-width spaces（肉眼不可见但影响解析）
- Private use area characters

**防护方法**：NFKC 规范化 + 危险 Unicode 类别剥离，最多递归 10 次。

**你的责任**：如果你通过 MCP 或 hooks 注入外部内容到 agent 对话中，**必须先做 sanitization**。源码对自己的输入做了净化，但外部输入是你的责任。

### 防护 2: 命令注入

```bash
# 危险：用户输入未转义直接拼入命令
BAD:  Bash("grep '${user_input}' file.txt")
# 如果 user_input = "'; rm -rf / #" 则注入成功

# 安全：使用 Grep 工具（不经过 shell 解释）
GOOD: Grep(pattern: user_input, path: "file.txt")
```

源码中 BashTool 会检测输出重定向（`extractOutputRedirections`）并验证目标路径权限。

### 防护 3: Prompt 注入

源码中的防护：
- 工具结果如果包含可疑的 prompt injection，agent 被指示标记给用户
- MCP 服务器返回的内容不会被当作 skill 执行（安全边界）
- Plugin 来源的 skill 不能执行 `!command`（shell 命令）

**你应该做的**：
```json
// 对于连接外部 MCP 服务器
{
  "mcpServers": {
    "untrusted-server": {
      // 永远不要给不信任的 MCP 服务器 write 权限
      // 在 permissions.deny 中限制其工具
    }
  }
}
```

## 四、环境变量与密钥保护

### 源码中的 GHA 密钥清洗

当 `CLAUDE_SUBPROCESS_ENV_SCRUB=true` 时，子进程环境变量中会被清除：

| 类别 | 被清除的变量 |
|------|-------------|
| API 密钥 | ANTHROPIC_API_KEY, CLAUDE_OAUTH_TOKEN, ANTHROPIC_AUTH_TOKEN |
| AWS | AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN |
| GCP | GOOGLE_APPLICATION_CREDENTIALS |
| Azure | AZURE_CLIENT_SECRET, AZURE_CLIENT_CERTIFICATE_PATH |
| GitHub Actions | ACTIONS_ID_TOKEN_REQUEST_TOKEN, ACTIONS_RUNTIME_TOKEN |
| OTEL | OTEL_EXPORTER_OTLP_*_HEADERS |

**为什么重要**：agent 执行的 Bash 命令继承当前进程的环境变量。如果不清洗，`echo $AWS_SECRET_ACCESS_KEY` 就能泄露密钥。

**最佳实践**：
```bash
# 在 CI/CD 中使用 agent 时
export CLAUDE_SUBPROCESS_ENV_SCRUB=true

# 或者更彻底：只传必要的环境变量
env -i HOME=$HOME PATH=$PATH ANTHROPIC_API_KEY=$KEY claude "..."
```

## 五、Hooks 安全

### 源码中的 Hook 限制

- Hook 超时：正常操作 10 分钟，SessionEnd 仅 1.5 秒
- Managed hooks only 模式：组织级策略可以限制只运行受管 hooks
- 全禁用模式：`shouldDisableAllHooksIncludingManaged()` 核按钮

### Hook 安全清单

```
[ ] Hook 脚本不要硬编码密钥
[ ] Hook 输出不要包含敏感信息（会被记录到日志）
[ ] PreToolUse hook 返回 approve 前要验证输入
[ ] PostToolUse hook 不要假设工具成功（检查 exit code）
[ ] Hook 脚本本身要有执行权限限制（chmod 700）
[ ] 不要在 hook 中调用外部 API（网络延迟会阻塞 agent）
```

## 六、安全配置模板

### 个人开发环境

```json
{
  "permissions": {
    "allow": [
      "Read", "Glob", "Grep",
      "Bash(npm test)", "Bash(npm run lint)",
      "Bash(git status)", "Bash(git diff *)", "Bash(git log *)",
      "Edit(src/**)", "Write(src/**)"
    ],
    "deny": [
      "Bash(rm -rf *)", "Bash(sudo *)", "Bash(curl * | *sh)",
      "Bash(git push *)", "Bash(git reset --hard *)",
      "Edit(.env*)", "Edit(.*rc)", "Edit(.git/*)",
      "Write(.env*)", "Read(*.pem)", "Read(*secret*)"
    ]
  }
}
```

### CI/CD 环境

```json
{
  "permissions": {
    "allow": [
      "Read", "Glob", "Grep",
      "Bash(npm test)", "Bash(npm run build)",
      "Edit(src/**)"
    ],
    "deny": [
      "Bash(curl *)", "Bash(wget *)", "Bash(ssh *)",
      "Bash(git push *)", "Bash(npm publish *)",
      "Bash(docker push *)",
      "Edit(.github/*)", "Edit(Dockerfile)",
      "WebFetch", "WebSearch"
    ]
  }
}
```

### 多人协作项目

```json
{
  "permissions": {
    "deny": [
      "Edit(.claude/settings.json)",
      "Edit(.claude/CLAUDE.md)",
      "Bash(git config *)",
      "Bash(gh repo *)",
      "Bash(npm owner *)"
    ]
  }
}
```

## 七、安全自检清单

```
基础防护:
[ ] deny 规则已配置高危命令
[ ] 敏感文件已禁止读写
[ ] CI 环境开启 CLAUDE_SUBPROCESS_ENV_SCRUB

进阶防护:
[ ] MCP 服务器权限已限制
[ ] Hook 脚本已审计
[ ] 外部输入已 sanitize
[ ] Agent 权限按最小权限原则配置

监控:
[ ] 日志记录已开启 (logPermissionDecision)
[ ] 成本追踪已开启
[ ] 异常行为告警已配置
```
