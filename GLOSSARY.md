# Pi Session Viewer 领域术语（Glossary）

本文件仅定义当前实现中使用的概念。中文用于描述与沟通，括号中的英文及代码标识用于定位源码。

## 会话与项目（Sessions and Projects）

**会话（Session）**：Pi Agent 一次运行形成的 JSONL 记录，可以包含线性历史和分支。源码类型为 `ParsedSession`；不要与单次轮次混淆。

**轮次（Turn）**：由一条用户消息触发、包含随后 Assistant、Thinking 和工具交互的完整交互单元。源码类型为 `TimelineTurn`。`custom` 消息触发的运行在界面中显示为独立的 `Custom run`。

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

**提示词格式（Prompt Format）**：`parseSystemPromptSections` 的结构识别结果。`tagged` 表示 Pi 当前使用的 XML 风格顶层分区；`unknown` 表示无法识别的非空内容；`empty` 表示空白提示词。无法识别时保留完整原文，不假定分区含义。

**提示词分区（Prompt Section）**：系统提示词中的一个命名块。Pi 的标准分区包括 `tools`、`rules`、`docs`、`addendum`、`project_context`、`skills`、`cwd`；扩展还可以通过 `sections` 添加 `mcp_servers`。各块独立展示。

**区间归属（Section Claim）**：解析后的 `ranges` 记录每个分区在原文中的字符范围。所有非空白字符必须恰好归属一个范围，范围之间不重叠；无法识别的内容也不能丢失。

**未识别分区（Unrecognized Section）**：提示词包含未建模的顶层标签时，解析器将其加入 `unrecognizedSections`，并在界面中独立展示，不塞入其他已知块。

**提示词捕获（Prompt Capture）**：扩展在 `before_agent_start` 读取初始配置，在 `before_provider_request` 记录 `ctx.getSystemPrompt()` 与当前活动工具定义。首条用户消息已持久化时，用 `targetUserEntryId` 精确关联；不凭事件相邻位置猜测归属。这描述的是 Pi Harness 状态，并非 HTTP 请求的最终 Payload。

**提示词快照（Prompt Snapshot）**：携带完整文本的 `snapshot`，或通过 `promptHash` 引用已有文本的 `reference`。每次配置发生变化时仍需记录新的有效组成或工具定义；无法解析的引用显示为缺失，而不是使用当前配置补写历史。

**原生提示词基线（Vanilla Prompt Baseline）**：基于 `PI_PROMPT_BASELINE_VERSION` 对当前 Pi 默认工具和规则构造的比较基线。仅当捕获版本与该已验证版本完全一致时，才能选择 Vanilla Diff；其他版本可使用确切的前一快照或扩展修改前快照进行比较。

**上下文编辑（Context Edit）**：Pi 的追加式 `context_edit` 条目，针对未来模型上下文指定 `targetId` 与 `replacement`。`replacement: null` 表示排除目标，非空替换表示替换内容；原 JSONL 条目本身不会被就地改写。

**上下文投影（Context Projection）**：调用 Pi 自身的 `buildSessionProjection` 得到当前分支实际传给模型的消息集合，包括上下文编辑、压缩和排除效果；不拿原始会话文件冒充模型上下文。若无法调用 Pi API，就不展示猜测的投影结果。

**上下文排除（Context Exclusion）**：某个原始记录未产生模型可见消息。`omitted` 表示由明确的上下文编辑排除，`not-in-context` 表示其他原因（如压缩边界或工具配对）；界面标记原记录，不将其删除。

**上下文编辑关联（Context Edit Link）**：连接 `context_edit` 与对应目标及被同一编辑排除的条目，通过 `affectedEntryIds` 及 `targetEntryId` 实现双向定位。编辑归属仅来自当前分支的 Pi 原生投影，不使用其他分支上的编辑。

**用量条目（Usage Entry）**：Pi 的 `usage` 条目，可记录不附着于 Assistant 消息的模型用量，如 `kind: "cache_warm"`；不参与 LLM 上下文。

## 子代理与错误（Subagents and Errors）

**子代理目标解析（Subagent Target Resolution）**：子代理引用可以指向可运行的子会话或仅供阅读的转录镜像。优先尝试 `<parent-session-dir>/<runId>/run-0/session.jsonl`，再检查已记录的产物路径；仅真正的 Pi Session 才允许作为会话打开。

**操作错误（Action Error）**：一次动作失败（例如子代理产物不存在）时显示在时间轴上方的可关闭提示；不替换或清空当前已打开的会话。

## 当前验证约束（Verification Gates）

- `tests/pi-contract.test.ts` 使用已安装的 Pi 校验默认工具、规则、分区及 `tests/fixtures/prompts/current-*.json`。夹具由 `npm run fixtures:refresh` 调用 Pi 的 `buildSystemPrompt()` 生成，不能手工伪造。
- `tests/pi-entry-contract.test.ts` 根据 Pi 当前 `docs/session-format.md` 检查支持的会话条目类型。
- `tests/pi-tool-provenance-contract.test.ts` 以 Pi 自身的合成来源 API 校验工具来源分类。
- `tests/pi-context-projection-contract.test.ts` 比较 Pi 的原生上下文投影与 Viewer 展示；本机没有真实会话时，对应真实会话用例明确跳过。
- `tests/pi-live-roundtrip.test.ts` 运行真实 Pi CLI，使用本地模拟 Provider 检查提示词捕获及多轮执行。
- `npm run check:sessions` 检查实际会话与捕获提示词的解析质量；发现未知条目、未知分区或未归属内容会以非零退出码报告。
- `npm run verify` 执行单元与契约测试、正式构建、发布包检查和桌面浏览器端到端测试。
