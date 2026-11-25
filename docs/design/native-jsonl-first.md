# 原生 JSONL 分析

## 状态重放

`buildSessionView` 在选定分支上调用 `replayBranchState`，通过 Pi AI 的 `getCurrentSystemMessage` 增量重放系统消息。压缩检查点替换状态；缺少检查点清除当前状态。各事件共享所在位置的状态引用。工具调用使用当时原生声明，配对结果沿用调用定义。差异通过 `diffPersistedState` 比较前一已知状态，工具变化使用 Pi AI transcript 工具。

时间轴保持原生顺序，显示原生系统消息和压缩事件；原生工具声明变更或带工具状态的压缩检查点使用独立「工具定义」行，与系统提示词行共享同一条原始 JSONL 记录。没有状态不生成占位。系统提示词事件的「内容」通过 Pi AI 的 `getSystemMessageText` 渲染该位置重放的提示词正文，不包含额外分区说明或工具声明；Inspector 的「组成」直接展示原生提示词分区；工具定义的「内容」展示历史生效声明，工具来源直接显示在对应工具上。已知系统状态的「差异」支持两个基准：前一已知状态逐行比较（包含工具声明变更），以及 Vanilla 默认提示词逐行比较。首次已知状态默认使用 Vanilla，后续默认使用前一已知状态。普通事件的「概览」仅展示事件自身信息，工具调用及结果的来源标签使用关联的实际注册来源。存在明确强制提示词观测的事件可在「组成」中单独查看观测值。缺失与空状态分别显示，观测值不代表最终请求。浏览器离线使用同一重放模块，完整上下文投影仅由本地服务通过 Pi 原生 API 提供。

## Vanilla 默认基准

构建与开发服务启动时调用安装的 Pi 原生 `createCodingToolDefinitions` 和 `buildSystemPromptSections` 生成默认分区，不加载用户扩展、项目指令、Skills 或自定义配置。浏览器携带生成的版本化参考数据，离线可用。比较时使用会话头工作目录及原生 docs 分区中一致的安装路径，以减少环境路径噪声；无法确定时显示路径占位符。Vanilla 与原生历史状态独立，不替代未知状态，也不保证差异全部由插件导致（Pi 版本、配置与项目上下文也可能造成差异）。

## 补充观测

`pi-session-viewer.observation` 自定义条目由 Pi appendEntry 追加，字段为 `schemaVersion: 1`、`piVersion`、`anchorEntryId`、`assistantEntryId`，以及可选 `forcedPrompt` 和 `toolSources`（名称与注册来源，null 表示来源未知）。请求钩子读取强制提示词配置与活动工具注册来源；完成回合验证分支锚点、Assistant ID 后记录。多次请求钩子导致关联不明确时放弃该回合；切换会话、分支及回合时清理待关联数据。来源仅首次或变化时记录，重声明及压缩清除旧来源。工具定义行可使用同一分支中其后首个 Assistant 的可靠关联请求来源；反向关联遇到任何更早的 Assistant、对应工具的删除或重声明、压缩边界即停止，不回填历史工具调用。重复或冲突观测不作为来源依据。不存在可靠观测时保持未知。明确空字符串为有效观测。

不保存请求 payload、请求头、普通提示词或重复工具 schema；观测是中间 Harness 信息，不代表最终 Provider 请求。已存在的其他 Viewer 自定义记录不参与分析，原始树关系不变。

## 验证

`npm run check:sessions` 对照 Pi 原生投影及 transcript 重放验证分支叶节点与系统/压缩位置。`npm run verify` 执行单元、真实 CLI 与模拟 Provider、构建、发布包及桌面浏览器测试。
