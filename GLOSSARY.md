# Pi Session Viewer 领域术语（Glossary）

本文件仅定义当前实现中使用的概念。中文用于描述与沟通，括号中的英文及代码标识用于定位源码。

## 会话与项目（Sessions and Projects）

**会话（Session）**：Pi Agent 一次运行形成的 JSONL 记录，可以包含线性历史和分支。源码类型为 `ParsedSession`；不要与单次轮次混淆。

**轮次（Turn）**：由一条用户消息触发、包含随后 Assistant、Thinking 和工具交互的完整交互单元。源码类型为 `TimelineTurn`。

**项目（Project）**：工作目录 `cwd` 归一化后相同的会话集合，不等同于 Git 仓库。

**存储（Storage）**：Pi 管理 JSONL 会话文件；Viewer 无独立数据库或迁移，目录元数据和响应缓存均为内存缓存。

**会话目录（Session Catalog）**：将可独立浏览的顶层会话按项目索引；通过父子关系、已知子代理来源等判定的子会话及转录镜像不单独列出，但可从父会话中的引用打开。

**消歧项目名（Disambiguated Project Name）**：多个项目目录具有相同 basename 时，用最少的路径片段生成可区分的名称，而不是统一显示完整绝对路径。

## 时间轴与选择（Timeline and Selection）

**桌面工作区（Desktop Workspace）**：会话目录、时间轴和详情常驻三栏，面向宽度不小于 1024px 的桌面浏览器；事件筛选直接展示全部选项。

**可见事件（Visible Event）**：属于当前分支且通过事件类型过滤的事件。是否可见不决定 Inspector 是否选中该事件。

**选中事件（Selected Event）**：Inspector 当前展示详情的事件。过滤器隐藏对应时间轴行时仍可保持选中；主动跳转可恢复该类型的可见性。

**焦点事件（Focused Event）**：键盘导航当前定位的可见事件。移动焦点不会自动改变选中事件。

**会话视图（Session View）**：指定分支上的时间轴、轮次与统计投影（`SessionView`）。`buildSessionView` 负责构建，事件过滤、选中与焦点在 Web 端分别维护。

**工具因果关系（Tool Causality）**：工具调用（`tool-call`）和结果（`tool-result`）按调用标识配对，时间轴展示对应关系；不根据文本相似性推断配对。

## 提示词与上下文（Prompts and Context）

**持久化系统状态（Persisted System State）**：Pi 原生会话记录中的系统提示词分区与工具声明，沿指定分支重放系统消息及压缩检查点所得的状态。不包含仅在请求过程中发生且未持久化的覆盖。

**请求态系统状态（Request-time System State）**：某次模型请求使用的系统消息与工具声明，可以受强制提示词和请求级钩子影响；不等同于持久化系统状态，也不等同于任一扩展钩子所观察到的中间状态。

**补充观测（Supplemental Observation）**：扩展运行期间取得、而原生会话记录不能提供的历史事实。缺少观测不表示没有变化；不得用当前配置补写历史。

**提示词分区（Prompt Section）**：原生 System Message 的 `sections` 键值对；保留名称和原文，null 表示删除，不从文本推断结构。

**历史状态差异（Historical State Diff）**：比较同分支前一已知持久化系统状态，包括内容、命名分区及工具声明的新增、替换和删除；首份已知状态无比较基线。

**工具注册来源（Tool Registration Provenance）**：补充观测中的实际工具注册来源元数据。沿分支及声明生效区间使用，重声明和压缩检查点清除来源；无可靠观测显示未知。

**强制提示词（Forced Prompt）**：请求时观察到的 Harness `forceSystemPrompt` 字符串，包含明确空字符串；缺少观测不代表无覆盖。观测通过请求锚点及完成回合的 Assistant 条目 ID 关联，不覆盖持久化系统状态。

**上下文编辑（Context Edit）**：Pi 的追加式 `context_edit` 条目，针对未来模型上下文指定 `targetId` 与 `replacement`。`replacement: null` 表示排除目标，非空替换表示替换内容；原 JSONL 条目本身不会被就地改写。

**上下文投影（Context Projection）**：调用 Pi 自身的 `buildSessionProjection` 得到指定分支根据持久化记录构建的模型上下文，包括上下文编辑、压缩和排除效果；不保证包含未持久化的请求级修改。若无法调用 Pi API，就不展示猜测的投影结果。

**上下文排除（Context Exclusion）**：某个原始记录未产生模型可见消息。`omitted` 表示由明确的上下文编辑排除，`not-in-context` 表示其他原因（如压缩边界或工具配对）；界面标记原记录，不将其删除。

**上下文编辑关联（Context Edit Link）**：连接 `context_edit` 与对应目标及被同一编辑排除的条目，通过 `affectedEntryIds` 及 `targetEntryId` 实现双向定位。编辑归属仅来自当前分支的 Pi 原生投影，不使用其他分支上的编辑。

**用量条目（Usage Entry）**：Pi 的 `usage` 条目，可记录不附着于 Assistant 消息的模型用量，如 `kind: "cache_warm"`；不参与 LLM 上下文。

## 子代理与错误（Subagents and Errors）

**子代理目标解析（Subagent Target Resolution）**：子代理引用可以指向可运行的子会话或仅供阅读的转录镜像。优先尝试 `<parent-session-dir>/<runId>/run-0/session.jsonl`，再检查已记录的产物路径；仅真正的 Pi Session 才允许作为会话打开。

**操作错误（Action Error）**：一次动作失败（例如子代理产物不存在）时显示在时间轴上方的可关闭提示；不替换或清空当前已打开的会话。

## 当前验证约束（Verification Gates）

- `src/core/native-state.test.ts` 验证历史状态、分支、工具和压缩语义。
- `tests/pi-entry-contract.test.ts` 根据 Pi 当前 `docs/session-format.md` 检查支持的会话条目类型。
- `tests/pi-tool-provenance-contract.test.ts` 以 Pi 自身的合成来源 API 校验工具来源分类。
- `tests/pi-context-projection-contract.test.ts` 比较 Pi 的原生上下文投影与 Viewer 展示；本机没有真实会话时，对应真实会话用例明确跳过。
- `tests/pi-live-roundtrip.test.ts` 运行真实 Pi CLI，使用本地模拟 Provider 检查原生重放与补充观测及多轮执行。
- `npm run check:sessions` 对照 Pi 原生投影校验历史系统状态，统计未知状态、忽略的 Viewer 记录及上下文编辑；报告解析诊断和契约不一致，无已知样本时明确提示。
- `npm run verify` 执行单元与契约测试、正式构建、发布包检查和桌面浏览器端到端测试。
