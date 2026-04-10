---
name: ts-cli-engineering
description: TypeScript 与 CLI 工程最佳实践 — 从一个 50 万行生产级 CLI 源码中蒸馏的模式与惯例
user-invocable: true
---

# TypeScript + CLI 工程最佳实践

> 来源：对 kele-code（~1900 文件，51万行 TypeScript）的全面逆向分析。每条实践都附带源码出处。

---

## 一、类型系统高级用法

### 1. Branded Types：编译期防混淆

```typescript
// types/ids.ts
export type SessionId = string & { readonly __brand: 'SessionId' }
export type AgentId = string & { readonly __brand: 'AgentId' }

export function toAgentId(s: string): AgentId | null {
  return AGENT_ID_PATTERN.test(s) ? (s as AgentId) : null
}
```

**为什么**：`SessionId` 和 `AgentId` 在运行时都是 string，但编译期不能混用。如果你把 `agentId` 传给期望 `sessionId` 的函数，TypeScript 会报错。`__brand` 是 phantom property，运行时不存在，零开销。

**适用场景**：所有长得像 string/number 但语义不同的 ID 类型。

### 2. `satisfies` 保留字面量类型

```typescript
// utils/modelCost.ts
const MODEL_COSTS = {
  'ab-opus-4-6': { input: 15, output: 75 },
  'ab-sonnet-4-6': { input: 3, output: 15 },
} as const satisfies Record<string, { input: number; output: number }>
```

**为什么**：`as const` 保留字面量类型（`'ab-opus-4-6'` 而不是 `string`），`satisfies` 在不拓宽类型的前提下做类型检查。两者结合 = 既有精确类型，又有编译期校验。

### 3. 判别联合 + 类型守卫

```typescript
// utils/agentContext.ts
export type AgentContext = SubagentContext | TeammateAgentContext

// 判别字段: agentType
export function isTeammateAgentContext(ctx: AgentContext | undefined): ctx is TeammateAgentContext {
  if (isAgentSwarmsEnabled()) {
    return ctx?.agentType === 'teammate'
  }
  return false  // feature gate 关闭时永远不是 teammate
}
```

**技巧**：类型守卫内嵌 feature flag 检查。不只是类型收窄，还包含业务逻辑。

### 4. DeepImmutable 防止敏感状态被意外修改

```typescript
// Tool.ts
export type ToolPermissionContext = DeepImmutable<{
  mode: PermissionMode
  alwaysAllowRules: ToolPermissionRulesBySource
  additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>
}>
```

**为什么**：权限上下文被传递给所有工具。如果某个工具意外修改了 `alwaysAllowRules`，会影响后续所有工具的权限判断。`DeepImmutable` 递归地将所有嵌套属性变为 `readonly`。

### 5. Builder 模式 + 条件类型填充默认值

```typescript
// Tool.ts
const TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: () => false,    // 默认不安全 (fail-closed)
  isDestructive: () => false,
  isReadOnly: () => false,
}

export function buildTool<D extends AnyToolDef>(def: D): BuiltTool<D> {
  return { ...TOOL_DEFAULTS, userFacingName: () => def.name, ...def } as BuiltTool<D>
}
```

**为什么**：`BuiltTool<D>` 用条件类型消除可选性（`-?`），保证所有默认字段在编译期都存在。Spread 顺序：defaults → computed → user definition（用户覆盖优先）。

### 6. Zod 判别联合 + lazySchema 破循环依赖

```typescript
// schemas/hooks.ts
export const HookCommandSchema = lazySchema(() => {
  const { BashCommandHookSchema, PromptHookSchema, AgentHookSchema, HttpHookSchema } = buildHookSchemas()
  return z.discriminatedUnion('type', [
    BashCommandHookSchema, PromptHookSchema, AgentHookSchema, HttpHookSchema
  ])
})
```

**为什么**：`lazySchema()` 将 schema 构造延迟到首次调用时。这打破了 hooks.ts ↔ plugins.ts 的循环依赖。`z.discriminatedUnion` 比普通 `z.union` 快得多（按判别字段跳转，不逐个尝试）。

---

## 二、错误处理

### 7. 错误分类器模式

```typescript
// utils/errors.ts
export type AxiosErrorKind = 'auth' | 'timeout' | 'network' | 'http' | 'other'

export function classifyAxiosError(e: unknown): {
  kind: AxiosErrorKind; status?: number; message: string
} {
  // 不用 axios.isAxiosError()，避免对 axios 的依赖
  if (!e || typeof e !== 'object' || !('isAxiosError' in e)) {
    return { kind: 'other', message: String(e) }
  }
  // 按 status code 分桶
}
```

**为什么**：将 unknown 错误分类成语义类别（auth/timeout/network/http/other），上层按类别决定重试/提示/放弃。用 duck typing（`'isAxiosError' in e`）而非 `instanceof`，因为 module reloading 会破坏 instanceof。

### 8. 安全提取器 + 谓词组合

```typescript
// utils/errors.ts
export function getErrnoCode(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e && typeof e.code === 'string') return e.code
  return undefined
}

// 基于提取器构建谓词
export function isFsInaccessible(e: unknown): e is NodeJS.ErrnoException {
  const code = getErrnoCode(e)
  return code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'ENOTDIR' || code === 'ELOOP'
}
```

**模式**：提取器（extractor）+ 谓词（predicate）分离。提取器可复用，谓词组合多个条件。比 `(e as NodeJS.ErrnoException).code` 安全得多。

### 9. AbortError 的三重检测

```typescript
export function isAbortError(e: unknown): boolean {
  return (
    e instanceof AbortError ||
    e instanceof APIUserAbortError ||
    (e instanceof Error && e.name === 'AbortError')  // minified builds 兜底
  )
}
```

**为什么**：minified builds 会 mangle 类名，`instanceof` 可能失效。检查 `.name === 'AbortError'` 作为最后防线。

### 10. 遥测安全的错误类

```typescript
export class TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS extends Error {
  readonly telemetryMessage: string
  constructor(message: string, telemetryMessage?: string) {
    super(message)
    this.telemetryMessage = telemetryMessage ?? message
  }
}
```

**为什么**：错误消息可能包含文件路径或代码片段（PII）。这个类名故意很长，迫使开发者在创建时确认消息不含敏感信息。`telemetryMessage` 是清洗后的版本。

---

## 三、缓存与记忆化

### 11. 写穿缓存 + 后台刷新 + 身份守卫

```typescript
// utils/memoize.ts
const memoized = (...args) => {
  const cached = cache.get(key)
  if (cached && now - cached.timestamp > TTL && !cached.refreshing) {
    cached.refreshing = true
    Promise.resolve().then(() => {
      const newValue = f(...args)
      if (cache.get(key) === cached) {   // 身份守卫！
        cache.set(key, { value: newValue, timestamp: Date.now(), refreshing: false })
      }
    }).catch(() => {
      if (cache.get(key) === cached) {   // 身份守卫！
        cache.delete(key)                 // 错误时删除，而非保留过期数据
      }
    })
    return cached.value  // 立即返回旧值
  }
}
```

**身份守卫 `cache.get(key) === cached`**：并发场景下，cache.clear() 可能在微任务排队期间被调用，导致另一个冷未命中写入新条目。如果没有身份守卫，stale refresh 会覆盖新数据（比删除更糟——错误数据持续整个 TTL）。

**源码注释原文**：*".then overwriting with the stale refresh's result is worse than .catch deleting (persists wrong data for full TTL vs. self-correcting on next call)"*

### 12. 异步冷未命中去重

```typescript
const inFlight = new Map<string, Promise<Result>>()

const memoized = async (...args) => {
  const pending = inFlight.get(key)
  if (pending) return pending     // 复用正在进行的请求

  const promise = f(...args)
  inFlight.set(key, promise)
  try {
    const result = await promise
    if (inFlight.get(key) === promise) {  // 身份守卫
      cache.set(key, { value: result, ... })
    }
    return result
  } finally {
    if (inFlight.get(key) === promise) {
      inFlight.delete(key)
    }
  }
}
```

**为什么**：10 个并发请求同一个 key 时，只有第一个真正调用 f()，其余 9 个共享同一个 Promise。`finally` 中的身份守卫防止清除被 clear() 后重新创建的 inFlight 条目。

### 13. LRU 缓存 + 路径规范化 + 大小限制

```typescript
// utils/fileStateCache.ts
export class FileStateCache {
  private cache: LRUCache<string, FileState>

  constructor(maxEntries: number, maxSizeBytes: number) {
    this.cache = new LRUCache({
      max: maxEntries,
      maxSize: maxSizeBytes,
      sizeCalculation: value => Math.max(1, Buffer.byteLength(value.content)),
    })
  }

  get(key: string) { return this.cache.get(normalize(key)) }  // 路径规范化
  set(key: string, value: FileState) { this.cache.set(normalize(key), value) }
}
```

**源码注释**：之前用 lodash memoize 导致内存膨胀到 300MB+。改用 LRU + maxSize 后限制在 25MB。`normalize(key)` 确保 `/foo/../bar` 和 `/bar` 命中同一条目。

---

## 四、模块组织与循环依赖

### 14. 延迟 require 破循环

```typescript
// tools.ts
// Lazy require to break: tools.ts → TeamCreateTool → ... → tools.ts
const getTeamCreateTool = () =>
  require('./tools/TeamCreateTool/TeamCreateTool.js').TeamCreateTool as
    typeof import('./tools/TeamCreateTool/TeamCreateTool.js').TeamCreateTool
```

**技巧**：`require()` 包在函数里延迟到调用时，但 `typeof import(...)` 保留编译期类型信息。

### 15. 纯类型模块打破循环

```typescript
// types/permissions.ts
/**
 * Pure type definitions extracted to break import cycles.
 * This file contains ONLY type definitions and constants with NO runtime dependencies.
 * Implementation files remain in src/utils/permissions/ but can now import from here.
 */
```

**模式**：把类型定义从实现中抽出来放到独立文件。两边都可以导入类型文件而不产生运行时循环依赖。

### 16. Side-effect 自注册模式

```typescript
// utils/swarm/backends/TmuxBackend.ts (文件末尾)
registerBackend('tmux', TmuxBackend)
// 注释: "This side effect is intentional - the registry needs backends to
// self-register to avoid circular dependencies."
```

**为什么**：注册中心不需要知道每个后端的具体类型。后端模块加载时自动注册，避免注册中心引用所有后端导致的循环。

### 17. 工具注册表的排序保缓存

```typescript
// tools.ts
export function assembleToolPool(permCtx, mcpTools): Tools {
  const builtIn = getTools(permCtx)
  const allowed = filterToolsByDenyRules(mcpTools, permCtx)
  // 排序保持 prompt-cache 稳定：内置工具在前连续排列，MCP 工具在后
  const byName = (a, b) => a.name.localeCompare(b.name)
  return uniqBy([...builtIn].sort(byName).concat(allowed.sort(byName)), 'name')
}
```

**为什么**：tool schema 进入 API 请求的 system prompt 部分。如果顺序变化，prompt cache 失效。按名称排序保证稳定性。

---

## 五、CLI 启动优化

### 18. 并行预取：利用用户输入的等待时间

```typescript
// main.tsx 文件顶部 (import 之前)
profileCheckpoint('main_tsx_entry')
startMdmRawRead()         // 启动 MDM 子进程
startKeychainPrefetch()    // 启动 macOS 钥匙串读取
// ...然后是 ~135ms 的其他 import
```

**为什么**：模块导入是同步的阻塞操作（~135ms）。在它们之前启动异步子进程，利用 import 的等待时间并行执行 I/O。

### 19. 延迟预取：首屏渲染后再做

```typescript
// main.tsx
function startDeferredPrefetches() {
  // 这些在首次 render 之后执行，不阻塞初始画面
  prefetchAvailableModels()
  prefetchGrowthBookFeatures()
  prefetchOrganizationSettings()
}
```

**为什么**：用户看到界面 > 预加载数据。分两批：首批（阻塞等级，import 期间）和延迟批（首屏后）。

### 20. Feature Flag 的构建时死代码消除

```typescript
// main.tsx
const coordinatorModule = feature('COORDINATOR_MODE')
  ? require('./coordinator/coordinatorMode.js') : null
```

**为什么**：`feature()` 由 `bun:bundle` 在构建时求值。如果 flag 关闭，整个 require 及其依赖树被 tree-shake 掉，不进入最终 bundle。

### 21. 启动性能采样

```typescript
// utils/startupProfiler.ts
const STATSIG_SAMPLE_RATE = 0.005   // 0.5% 外部用户
const STATSIG_LOGGING_SAMPLED =
  process.env.USER_TYPE === 'ant' || Math.random() < STATSIG_SAMPLE_RATE

export function profileCheckpoint(name: string): void {
  if (!SHOULD_PROFILE) return        // 零开销对未采样用户
  perf.mark(name)
}
```

**为什么**：100% 内部用户 + 0.5% 外部用户采样。未采样用户完全零开销（函数内第一行就 return）。

---

## 六、进程管理与优雅关闭

### 22. 分阶段关闭：按优先级排序

```typescript
// utils/gracefulShutdown.ts
async function gracefulShutdown(exitCode, reason) {
  if (shutdownInProgress) return          // 幂等
  shutdownInProgress = true

  // 1. 安全网定时器（hook 超时 + 3.5s 余量）
  failsafeTimer = setTimeout(forceExit, Math.max(5000, hookTimeout + 3500))

  // 2. 终端状态恢复（同步！不能等 async）
  cleanupTerminalModes()
  printResumeHint()

  // 3. 会话持久化（最重要的数据）
  await runCleanupFunctions()              // 2s 超时

  // 4. SessionEnd hooks
  await executeSessionEndHooks(reason)     // 1.5s 超时

  // 5. 遥测刷新（可丢弃）
  await Promise.race([
    Promise.all([flushEvents(), flushDatadog()]),
    sleep(500)                             // 500ms 后放弃
  ])

  forceExit(exitCode)
}
```

**核心原则**：
- 终端恢复必须是**同步的**（async 可能来不及执行）
- 数据持久化 > hooks > 遥测（优先级递减）
- 每层都有独立超时，加安全网兜底

### 23. 终端序列的发送顺序

```typescript
// gracefulShutdown.ts
function cleanupTerminalModes() {
  // 1. 先关鼠标追踪（需要终端 round-trip 时间）
  writeSync(DISABLE_MOUSE_TRACKING)
  // 2. 退出 alt-screen
  writeSync(EXIT_ALT_SCREEN)
  // 3. 显示光标
  writeSync(SHOW_CURSOR)
  // 4. 最后 drain stdin
  drainStdin()
}
```

**源码注释**：*"Unconditionally sends disable sequences (terminal detection unreliable in tmux/screen)"* — 不检测终端类型，直接发送所有禁用序列。多发无害，遗漏则终端状态损坏。

### 24. 孤儿进程检测

```typescript
// 每 30 秒检查 stdout 是否可写
orphanInterval = setInterval(() => {
  if (!process.stdout.writable) {
    // 父终端关闭但没发 SIGHUP（tmux detach 等场景）
    gracefulShutdown(0, 'orphan_detected')
  }
}, 30_000)
```

**为什么**：tmux detach、终端窗口关闭等场景下，不一定会收到 SIGHUP。定期检查 stdout 可写性作为兜底。

### 25. 清理注册表模式（松耦合关闭）

```typescript
// utils/cleanupRegistry.ts
const cleanupFunctions = new Set<() => Promise<void>>()

export function registerCleanup(fn: () => Promise<void>): () => void {
  cleanupFunctions.add(fn)
  return () => cleanupFunctions.delete(fn)  // 返回注销函数
}

export async function runCleanupFunctions() {
  await Promise.all(Array.from(cleanupFunctions).map(fn => fn()))
}
```

**为什么**：各模块在初始化时注册自己的清理逻辑，关闭时统一执行。没有中心化的"谁需要清理"列表，完全松耦合。

---

## 七、并发安全

### 26. AsyncLocalStorage 隔离并发 Agent

```typescript
// utils/agentContext.ts
/**
 * WHY AsyncLocalStorage (not AppState):
 * When agents are backgrounded (ctrl+b), multiple agents run concurrently
 * in the same process. AppState is shared → Agent A overwrites Agent B's context.
 * AsyncLocalStorage isolates each async execution chain.
 */
const agentContextStorage = new AsyncLocalStorage<AgentContext>()

export function runWithAgentContext<T>(context: AgentContext, fn: () => T): T {
  return agentContextStorage.run(context, fn)
}
```

**经验**：全局状态（AppState）在单 agent 时没问题，但多 agent 并发时就会互相覆盖。`AsyncLocalStorage` 按异步调用链隔离，每个 agent 看到自己的上下文。

### 27. WeakRef 防止 AbortController 内存泄漏

```typescript
// utils/abortController.ts
export function createChildAbortController(parent: AbortController): AbortController {
  const child = new AbortController()
  const weakChild = new WeakRef(child)
  const weakParent = new WeakRef(parent)

  // 模块级函数避免每次调用都创建闭包
  const handler = propagateAbort.bind(weakParent, weakChild)
  parent.signal.addEventListener('abort', handler, { once: true })

  // 子 abort 时移除父监听器
  child.signal.addEventListener('abort',
    removeAbortHandler.bind(weakParent, new WeakRef(handler)),
    { once: true })

  return child
}
```

**源码注释**：*"WeakRefs prevent the parent from keeping abandoned children alive. Module-scope functions avoid per-call closure allocation."*

**三个关键点**：
1. WeakRef 防止父持有已废弃子的强引用（GC 友好）
2. 子 abort 时自动移除父的监听器（防积累）
3. 模块级函数而非闭包（减少 GC 压力）

### 28. 文件锁 + 指数退避

```typescript
// utils/tasks.ts
// 锁配置：最多重试 30 次，2.6s 总等待（适配多 agent swarm 场景）
const LOCKFILE_OPTIONS = {
  retries: { retries: 30, minTimeout: 5, maxTimeout: 100 }
}
```

**为什么**：多个 agent（团队模式）可能同时读写 task 文件。文件锁 + 指数退避确保并发安全。30 次重试 × 5-100ms = 最长等 2.6 秒，覆盖大多数 swarm 竞争场景。

---

## 八、源码注释中的工程智慧

### 29. 注释应该解释 WHY，不是 WHAT

源码中 `constants/prompts.ts` 的 coding guideline：

> *"Default to writing no comments. Only add one when the WHY is non-obvious: a hidden constraint, a subtle invariant, a workaround for a specific bug, behavior that would surprise a reader."*

**好注释的例子**（来自本项目）：

```typescript
// Re-entrancy guard: prevents getConfig → logEvent → getGlobalConfig → getConfig
// infinite recursion when the config file is corrupted
let insideGetConfig = false
```

```typescript
// eslint-disable-next-line custom-rules/no-direct-json-operations
// -- jsonParse() pulls slowOperations (lodash-es/cloneDeep) into the
// early-startup import chain
JSON.parse(raw)
```

```typescript
// SECURITY: PowerShell's tokenizer accepts en-dash/em-dash/horizontal-bar
// as dash characters
```

### 30. @[MODEL LAUNCH] 标记：变更检查清单

```typescript
// utils/effort.ts
// @[MODEL LAUNCH]: Add the new model to the allowlist if it supports 'max' effort
```

**模式**：在代码中用特殊标记（如 `@[MODEL LAUNCH]`）标注"当 X 事件发生时需要检查的地方"。全局搜索标记即可得到完整的变更检查清单。

### 31. Bug 编号 + 根因记录

```typescript
// schemas/hooks.ts
// DO NOT add .transform() here. (gh-24920, CC-79). The transform wrapped
// the string in `(_msgs) => prompt` for ExitPlanModeV2Tool that has since
// been refactored. Round-tripping through JSON.stringify silently drops
// the function value, deleting the user's prompt from settings.json.
```

**模式**：注释包含 bug 编号 + 具体根因 + 历史上下文。让未来的开发者知道为什么**不能**做某个看似合理的"改进"。

### 32. 经验性决策 vs 普遍性判断

```typescript
// utils/permissions/dangerousPatterns.ts
// These stay ant-only — external users don't have coo, and the rest
// are an empirical-risk call grounded in ant sandbox data, not a
// universal "this tool is unsafe" judgment.
```

**智慧**：安全决策应基于数据（"sandbox 数据显示这些工具经常被过度授权"），而非主观判断（"这个工具不安全"）。

---

## 九、速查表：模式适用场景

| 场景 | 推荐模式 | 出处 |
|------|---------|------|
| 多种 ID 类型防混淆 | Branded Types | types/ids.ts |
| 配置对象需要编译期校验 | `as const satisfies` | utils/modelCost.ts |
| 联合类型收窄 + 业务逻辑 | 类型守卫嵌入 feature flag | utils/agentContext.ts |
| 敏感状态传递 | DeepImmutable | Tool.ts |
| 工具/插件注册 | Builder + 安全默认值 | Tool.ts buildTool() |
| 运行时 schema 校验 | Zod discriminatedUnion | schemas/hooks.ts |
| 循环依赖 | lazy require + 类型模块 | tools.ts, types/permissions.ts |
| 自动注册 | 模块级 side-effect | TmuxBackend.ts |
| 高频缓存 | 写穿 + 后台刷新 + 身份守卫 | utils/memoize.ts |
| 并发缓存 | inFlight 去重 | utils/memoize.ts |
| 文件路径缓存 | LRU + normalize + maxSize | utils/fileStateCache.ts |
| unknown 错误处理 | 提取器 + 谓词 | utils/errors.ts |
| 遥测错误 | 长名称强制审查 | TelemetrySafeError |
| 启动优化 | 并行预取 + 延迟预取 | main.tsx |
| 构建优化 | feature() 死代码消除 | main.tsx |
| 优雅关闭 | 分阶段 + 安全网 + 同步终端恢复 | gracefulShutdown.ts |
| 多 agent 并发 | AsyncLocalStorage | agentContext.ts |
| 父子 abort | WeakRef + 自动清理 | abortController.ts |
| 变更检查 | @[EVENT] 标记 | effort.ts |
