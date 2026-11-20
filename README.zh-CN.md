# Pi Session Viewer (Pi 会话分析)

[English](README.md) | [简体中文](README.zh-CN.md)

为 [Pi](https://github.com/earendil-works/pi) 编程助手量身打造的本地只读会话可视化与系统提示词（System Prompt）分析面板。直观呈现多轮时间轴、工具调用因果链以及提示词快照结构。

![Pi Session Viewer 预览图](https://raw.githubusercontent.com/hfrancisla/pi-session-viewer/main/assets/gallery-preview.webp)

## 安装

```bash
pi install npm:@hfrancisla/pi-session-viewer
```

重启 Pi 或执行 `/reload`。扩展将自动加载，并在下一轮对话起开始捕获系统提示词。

## 使用方法

```text
/session-viewer       # 启动面板（等同于 on）
/session-viewer on    # 启动面板并在浏览器中打开
/session-viewer off   # 关闭面板（系统提示词捕获仍继续工作）
```

- 启动面板后会在浏览器中打开带有独立访问令牌的本地仪表盘。
- 切换会话时（`/new`、`/resume`、`/fork`），需重新执行 `/session-viewer on`。
- 直接从 Pi 本地存储发现会话，或通过浏览器导入任意 `.jsonl` 会话文件。

## 核心特性

- **时间轴与调用因果链**：清晰呈现用户轮次、Thinking 推理块及配对工具调用，并带有调用时序因果导轨。
- **系统提示词结构拆解**：深度解析系统提示词的组成，包括基础模板、挂载工具、Skills 以及上下文参考文件。
- **分版本原生提示词对比**：Pi 1.5.0 与 1.6.0 的原生提示词基线已经逐字核对；对未验证的版本禁用 Vanilla 对比，避免错误展示差异。
- **多项目会话目录**：按工作目录归类会话，并对重名目录进行自动路径消歧。
- **离线 JSONL 导入**：支持直接选取本地会话文件进行离线分析。

## 安全与隐私

- **仅限本地访问**：严格监听 `127.0.0.1`，并为每次启动生成独立的 Bearer Token。无云端同步、无遥测上报、无远程访问。
- **只读设计**：Web 界面无法修改会话或执行任何终端命令。
- **捕获范围**：仅在本地会话文件中记录系统提示词、Skill 元数据与上下文文件快照。**绝不**记录 API Key、请求标头或敏感凭证。
- **捕获精度与边界**：插件在 `before_provider_request` 阶段通过 Pi 的 `ctx.getSystemPrompt()` 及活动工具元数据记录 *Pi Harness 的提示词状态*，并展示会话中 Pi 原生持久化的 System Message 增量更新。但其他扩展在该钩子内对提供商最终请求 Payload 的修改不会反映到 `ctx.getSystemPrompt()`；本插件**不是** HTTP 原始请求录制器。上下文文件内容本身可能包含敏感数据，请妥善保管导出的会话文件。
- **历史记录**：没有关联系统提示词捕获记录的轮次会显示为 *未记录*；Viewer 不推断缺失原因，也不会根据当前配置重建历史提示词。

## 本地开发

```bash
npm install
npm run dev        # Web 开发服务器
npm test           # 单元与集成测试
npm run build      # 构建 Web 静态资产与扩展产物
npm run verify     # 完整验证套件
npm run test:ui    # 浏览器端到端测试（需安装 Playwright Chromium）
```

会话目录查找顺序：`PI_CODING_AGENT_SESSION_DIR` → `~/.pi/agent/settings.json` → `~/.pi/agent/sessions`。

单元测试中还会启动真实 Pi CLI，连接本地模拟的 OpenAI 兼容提供商，验证多轮提示词、工具执行、会话新建与恢复，不调用收费模型服务。
