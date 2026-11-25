# 原生 JSONL 分析

## 状态重放

`buildSessionView` 在选定分支上调用 `replayBranchState`，通过 Pi AI 的 `getCurrentSystemMessage` 增量重放系统消息。压缩检查点替换状态；缺少检查点清除当前状态。各事件共享所在位置的状态引用。工具调用使用当时原生声明，配对结果沿用调用定义。差异通过 `diffPersistedState` 比较前一已知状态，工具变化使用 Pi AI transcript 工具。

时间轴保持原生顺序，显示原生系统消息和压缩事件；没有状态不生成占位。Inspector 的持久化状态页显示原始内容、原生分区、工具声明和独立补充观测；缺失与空状态分别显示。浏览器离线使用同一重放模块，完整上下文投影仅由本地服务通过 Pi 原生 API 提供。

## 补充观测

`pi-session-viewer.observation` 自定义条目由 Pi appendEntry 追加，字段为 `schemaVersion: 1`、`piVersion`、`anchorEntryId`、`assistantEntryId`，以及可选 `forcedPrompt` 和 `toolSources`（名称与注册来源，null 表示来源未知）。请求钩子读取强制提示词配置与活动工具注册来源；完成回合验证分支锚点、Assistant ID 后记录。多次请求钩子导致关联不明确时放弃该回合；切换会话、分支及回合时清理待关联数据。来源仅首次或变化时记录，重声明及压缩清除旧来源。不存在可靠观测时保持未知。明确空字符串为有效观测。

不保存请求 payload、请求头、普通提示词或重复工具 schema；观测是中间 Harness 信息，不代表最终 Provider 请求。已存在的其他 Viewer 自定义记录不参与分析，原始树关系不变。

## 验证

`npm run check:sessions` 对照 Pi 原生投影及 transcript 重放验证分支叶节点与系统/压缩位置。`npm run verify` 执行单元、真实 CLI 与模拟 Provider、构建、发布包及桌面浏览器测试。
