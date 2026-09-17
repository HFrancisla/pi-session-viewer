# Pi Session Viewer (Pi 会话分析)

[English](README.md) | [简体中文](README.zh-CN.md)

为 [Pi](https://github.com/earendil-works/pi) 编程助手量身打造的本地只读会话可视化与系统提示词（System Prompt）分析面板。直观呈现多轮时间轴、工具调用因果链以及提示词快照结构。

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
- **多项目会话目录**：按工作目录归类会话，并对重名目录进行自动路径消歧。
- **离线 JSONL 导入**：支持直接选取本地会话文件进行离线分析。

## 安全与隐私

- **仅限本地访问**：严格监听 `127.0.0.1`，并为每次启动生成独立的 Bearer Token。无云端同步、无遥测上报、无远程访问。
- **只读设计**：Web 界面无法修改会话或执行任何终端命令。
- **捕获范围**：仅在本地会话文件中记录系统提示词、Skill 元数据与上下文文件快照。**绝不**记录 API Key、请求标头或敏感凭证。
- **历史记录**：安装此扩展前的历史轮次将显示为 *未记录*，绝不凭空推断或伪造过去的提示词。

## 本地开发

```bash
npm install
npm run dev        # Web 开发服务器
npm test           # 单元与集成测试
npm run build      # 构建 Web 静态资产与扩展产物
npm run verify     # 完整验证套件
```

会话目录查找顺序：`PI_CODING_AGENT_SESSION_DIR` → `~/.pi/agent/settings.json` → `~/.pi/agent/sessions`。
