# Pi Session Viewer 发布为 Pi Package 的改造计划

## 1. 文档目的

本文档用于把当前 `pi-session-viewer` 开发项目改造成可通过 npm 发布、可被 Pi package gallery 发现、可使用 `pi install` 安装的正式 Pi package。

本文档是实施计划，不是产品设想。除“待确认发布信息”外，下面列出的产品行为均视为已确定约束。

## 2. 发布目标

目标安装方式：

```bash
pi install npm:@scope/pi-session-viewer
```

目标使用方式：

```text
/session-viewer on
/session-viewer off
```

安装后的默认行为：

- System prompt 捕获始终开启。
- 捕获不依赖 Web 服务是否运行。
- 不提供 capture on/off 命令。
- `/session-viewer on` 只启动本地分析面板。
- `/session-viewer off` 只停止本地分析面板。
- 停止面板不会停止捕获。
- 卸载 package 才会停止后续捕获。
- 卸载不会删除既有 session 中已经写入的捕获记录。

## 3. 非目标

首个可发布版本不包含以下能力：

- 不上传会话或 system prompt。
- 不提供云端服务。
- 不提供团队共享或远程访问。
- 不监听 `0.0.0.0`。
- 不捕获完整 provider request。
- 不保存 provider 请求头或认证信息。
- 不保证恢复扩展安装前的历史 system prompt。
- 不自动删除已有 session 数据。
- 不控制、暂停、重放或修改 Pi 会话。
- 不保证捕获未加载此 package 的第三方 agent/subagent 进程。
- 不在 npm 安装阶段启动服务或执行会话扫描。

## 4. 已确定的产品契约

### 4.1 捕获契约

扩展加载后自动注册捕获 hooks：

- `before_agent_start`：保存本轮 system prompt 的结构化构建输入。
- `agent_start`：捕获所有 `before_agent_start` 扩展处理后的 Pi 有效 system prompt。
- `before_provider_request`：检测同一 agent run 内 system prompt 是否因动态工具等原因发生变化。
- `agent_end`：清理本轮内存状态。

持久化使用：

```text
customType = pi-session-viewer.system-prompt
schemaVersion = 1
```

持久化规则：

- 一个新 prompt 哈希首次出现时写完整 `snapshot`。
- 相同 prompt 再次使用时写轻量 `reference`。
- prompt 变化时写新的完整 `snapshot`。
- 哈希算法使用 SHA-256。
- custom entry 不进入模型上下文。
- 初始捕获记录通过 `targetUserEntryId` 绑定用户轮次。
- 运行中 prompt 更新保留在实际发生位置。
- 现有 `customType` 和 schema v1 必须保持兼容。

捕获组成包括：

- 最终完整 Pi system prompt。
- 自定义基础 prompt。
- 激活工具名称。
- 工具 prompt snippets。
- prompt guidelines。
- append system prompt。
- context files 的路径和完整内容。
- skills 的名称、描述和路径。
- cwd。
- provider/model。
- 捕获时间、序号、阶段和内容哈希。

捕获边界：

- 捕获 Pi 的有效 system prompt 字符串。
- 不捕获 provider payload 的全部 messages。
- 不捕获认证信息。
- 不保证观察后续扩展对 provider payload 的直接改写。
- 原生工具 JSON Schema 不属于 system prompt；首版不额外持久化。

### 4.2 历史数据契约

- 扩展安装前的 system prompt 无法准确恢复。
- 历史轮次必须显示“系统提示词未记录”。
- 查看器不得使用当前 AGENTS.md、skills 或工具配置伪装成历史内容。
- 扩展安装后的下一轮开始产生真实捕获记录。
- 当前 Pi 进程安装 package 后需要 `/reload` 或重启才能加载扩展。

### 4.3 Web 服务契约

`/session-viewer on`：

- 幂等启动本地 Web 服务。
- 已启动时复用现有实例。
- 绑定 `127.0.0.1`。
- 让操作系统分配可用端口，避免固定端口冲突。
- 生成当前服务实例专属的随机访问 token。
- 显示访问 URL。
- 最好尝试打开默认浏览器；失败时保留可复制 URL。
- 不改变捕获状态。

`/session-viewer off`：

- 幂等关闭当前 Web 服务。
- 释放端口和文件句柄。
- 使旧 token 立即失效。
- 不改变捕获状态。
- 不删除 session 数据。

无参数或未知参数：

```text
用法：/session-viewer on | off
```

首版服务生命周期：

- Web 服务状态只属于当前 Pi 运行时，不写入磁盘。
- Pi 重启后面板默认为关闭。
- `session_shutdown` 必须关闭监听器。
- `/reload`、`/new`、`/resume` 或 `/fork` 后，用户需要重新执行 `/session-viewer on`。
- System prompt 捕获在新 runtime 加载后继续自动工作。

如果后续确认需要跨 session replacement 保持服务，再单独设计进程级 singleton；首版不使用 `globalThis` 或 detached child process 保活。

## 5. 当前状态与发布阻塞项

当前项目目录：

```text
/home/hzf/workspace/projects-mine/pi-session-viewer
```

当前已经具备：

- React + TypeScript 分析界面。
- Pi JSONL 只读扫描和解析。
- 会话树、分支、轮次与工具因果轨道。
- LLM 输出轮廓。
- System prompt 捕获扩展。
- System prompt 内容、组成与 Raw 查看。
- 历史缺失标记。
- 桌面与窄屏响应式界面。
- Vitest 和 Playwright 测试。

当前发布阻塞项：

- `package.json` 包含 `"private": true`。
- 缺少 `pi-package` keyword。
- 缺少 `pi.extensions` manifest。
- 缺少 `files` 白名单。
- 缺少 license、repository、homepage、bugs 和 author 元数据。
- `npm run start` 依赖 `tsx`，但 `tsx` 是 devDependency。
- `server/index.ts` 顶层导入 Vite，生产安装仍要求 Vite 存在。
- Web 服务与 Pi 扩展生命周期没有连接。
- `/session-viewer on|off` 尚未实现。
- 生产扩展和生产 Web 资源没有统一构建到 `dist/`。
- 当前服务使用固定端口 `5174`。
- 当前 API 没有实例 token。
- 当前全局安装使用手工软链接，发布安装后会造成重复扩展加载。
- 当前 README 主要面向源码运行，不足以说明 package 安装和敏感数据行为。

## 6. 目标架构

```text
Pi runtime
  │
  ├─ Package extension
  │    ├─ system prompt capture hooks（始终启用）
  │    ├─ /session-viewer on|off
  │    └─ local server lifecycle
  │
  ├─ SessionManager
  │    └─ *.jsonl custom prompt entries
  │
  └─ 127.0.0.1:<random-port>
       ├─ prebuilt web assets
       └─ authenticated read-only API
```

建议源码结构：

```text
pi-session-viewer/
├── package.json
├── README.md
├── LICENSE
├── assets/
│   └── gallery-preview.webp
├── src/
│   ├── extension/
│   │   ├── index.ts
│   │   ├── prompt-capture.ts
│   │   ├── commands.ts
│   │   ├── server-controller.ts
│   │   └── runtime-state.ts
│   ├── server/
│   │   ├── http-server.ts
│   │   ├── session-api.ts
│   │   ├── session-discovery.ts
│   │   ├── security.ts
│   │   └── static-assets.ts
│   ├── core/
│   │   ├── session-parser.ts
│   │   ├── causal-layout.ts
│   │   └── types.ts
│   └── web/
│       ├── App.tsx
│       ├── components/
│       └── styles.css
├── tests/
│   ├── fixtures/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   └── e2e/
└── dist/
    ├── extension/
    │   └── index.js
    └── web/
        ├── index.html
        └── assets/
```

## 7. 模块职责

### 7.1 `src/extension/index.ts`

职责：

- 作为 Pi package 唯一 extension 入口。
- 安装 system prompt 捕获 hooks。
- 注册 `/session-viewer` 命令。
- 在 `session_shutdown` 关闭服务。
- 不直接包含解析器或 HTTP 实现细节。

完成标准：

- 入口文件小于约 150 行。
- 不导入 Vite、Playwright、Vitest 或 `tsx`。
- Package 加载时不自动启动 Web 服务。
- Package 加载时立即注册捕获 hooks。

### 7.2 `prompt-capture.ts`

职责：

- 迁移当前 `pi-extension/system-prompt-capture.ts`。
- 保持 custom entry schema v1 兼容。
- 处理 snapshot/reference 去重。
- 捕获 agent start 与运行中 prompt 更新。
- 不包含 Web 服务逻辑。

完成标准：

- 安装 package 后第一轮必定出现捕获 entry。
- 相同 prompt 不重复存正文。
- prompt 变化会生成新 snapshot。
- 卸载/禁用 extension 后不再产生 entry。

### 7.3 `commands.ts`

职责：

- 解析 `/session-viewer on|off`。
- `on` 调用 server controller。
- `off` 调用 server controller。
- 给出明确、不可误解的通知。

命令反馈：

```text
/session-viewer on
面板已启动：http://127.0.0.1:<port>/#token=<token>
System prompt 捕获始终开启。
```

```text
/session-viewer off
面板已关闭。
System prompt 捕获仍在继续；卸载 package 才会停止捕获。
```

完成标准：

- `on` 连续执行两次只存在一个 listener。
- `off` 连续执行两次不抛错。
- 未知参数只返回用法，不改变服务状态。

### 7.4 `server-controller.ts`

职责：

- 管理 server handle、端口、token 和启动 Promise。
- 防止并发执行两次 `on` 创建多个 listener。
- 实现可重复关闭。
- 对浏览器打开失败进行降级。

状态机：

```text
stopped -> starting -> running -> stopping -> stopped
```

完成标准：

- 所有状态转换可测试。
- 启动失败后恢复到 `stopped`。
- 关闭后端口可重新绑定。
- 不产生 detached/orphan 进程。

### 7.5 `http-server.ts`

职责：

- 使用 Node `http` 提供静态资源和 API。
- 不在生产运行时依赖 Vite。
- 推荐移除 Express，减少 package 运行时依赖和攻击面。
- 使用 `import.meta.url` 定位 `dist/web`。

完成标准：

- `npm install --omit=dev` 后可以启动。
- 没有源码目录依赖。
- 没有 Vite、tsx 或 TypeScript runtime 依赖。

### 7.6 `security.ts`

职责：

- 生成至少 256-bit 随机 token。
- 验证 API 请求 token。
- 验证 Host。
- 拒绝跨源读取。
- 设置安全响应头。

建议 URL：

```text
http://127.0.0.1:<port>/#token=<random-token>
```

前端从 fragment 读取 token，存入 `sessionStorage`，随后调用 API 时发送：

```http
Authorization: Bearer <token>
```

安全头：

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cache-Control: no-store
```

API 不返回 CORS 允许头。

完成标准：

- 无 token 的 API 请求返回 401。
- 错误 token 返回 401。
- 正确 token 正常读取。
- Host 非 localhost/127.0.0.1 时拒绝。
- 路径遍历和 symlink 越界测试通过。
- token 不出现在服务日志。

## 8. API 设计

首版 API：

```text
GET /api/sessions
GET /api/sessions/:token
GET /api/health
```

约束：

- 全部 API 只读。
- `/api/sessions/:token` 中的 token 是文件标识，不是认证 token。
- 认证 token 只通过 `Authorization` header 传递。
- session 文件必须通过 `realpath` 验证位于允许根目录。
- 排除 `events.jsonl`、`*_transcript.jsonl` 和 subagent sidecar。
- 浏览器手动打开 JSONL 继续使用 File API，不交给服务端任意路径。
- API 响应设置 `Cache-Control: no-store`。

健康检查不得泄露路径或 session 内容：

```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

## 9. Package Manifest 改造

目标 `package.json` 示例：

```json
{
  "name": "@scope/pi-session-viewer",
  "version": "1.0.0",
  "description": "Local, read-only Pi session and system-prompt inspector",
  "type": "module",
  "license": "MIT",
  "keywords": [
    "pi-package",
    "pi",
    "session-viewer",
    "observability",
    "system-prompt"
  ],
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "engines": {
    "node": ">=20"
  },
  "pi": {
    "extensions": ["./dist/extension/index.js"],
    "image": "https://raw.githubusercontent.com/OWNER/REPO/main/assets/gallery-preview.webp"
  },
  "scripts": {
    "dev": "...",
    "build": "...",
    "test": "...",
    "test:ui": "...",
    "verify": "...",
    "prepack": "npm run verify && npm run build"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

必须删除：

```json
"private": true
```

如果生产扩展使用 `open` 等第三方库，应放入 `dependencies`。Pi 核心包只放 `peerDependencies`，范围使用 `"*"`，不打入 bundle。

完成标准：

- `npm pack --dry-run` 只包含允许文件。
- tarball 不包含 `src`、测试截图、真实 session、`.env` 或本地日志。
- tarball 内包含 `dist/extension/index.js` 和完整 `dist/web`。

## 10. 构建策略

### 10.1 Web 构建

使用 Vite 构建：

```text
src/web -> dist/web
```

要求：

- React、Lucide 和字体资源打入静态产物。
- 页面不依赖 CDN。
- API URL 使用相对路径。
- 构建后不引用 `/src/*`。
- hash 资源可长期缓存；HTML 和 API 不缓存。

### 10.2 Extension 构建

使用 `tsup` 或 `esbuild` 构建：

```text
src/extension/index.ts -> dist/extension/index.js
```

要求：

- 输出 ESM。
- `@earendil-works/pi-coding-agent` 标记为 external。
- Node built-ins 保持 external。
- 内部 server/core 模块打入扩展 bundle，或输出到 `dist/extension/chunks`。
- source map 可以包含，但不得嵌入本地绝对路径和 session 内容。

### 10.3 开发模式

开发模式可以保留 Vite HMR，但与生产入口分离：

```text
npm run dev:web
npm run dev:extension
npm run dev
```

生产 extension 不得静态导入 Vite。

完成标准：

```bash
rm -rf node_modules
npm install --omit=dev
```

在只存在生产依赖和 `dist` 的模拟安装目录中，Pi 能加载扩展并启动面板。

## 11. 前端改造

保留现有功能：

- 自动发现 session。
- 手动打开 JSONL。
- 分支切换。
- system prompt 捕获、缺失状态和组成查看。
- LLM 输出轮廓。
- 并行工具因果轨道。
- 事件类型过滤。
- 内容/组成/概览/Raw 检查器。
- 桌面和窄屏布局。

新增前端行为：

- 从 URL fragment 读取实例 token。
- token 缺失时显示明确错误，不发送 API 请求。
- token 进入 `sessionStorage` 后从地址栏移除。
- API 请求统一添加 `Authorization` header。
- 服务关闭时显示“面板服务已关闭或 Pi 已退出”。
- Package 版本和 schema 版本可在错误诊断中查看。

完成标准：

- token 不出现在网络日志 URL 中。
- 页面刷新后仍能使用当前 tab 的 sessionStorage token。
- 新窗口没有 token 时无法读取 API。
- 所有错误状态提供明确处理方式。

## 12. 敏感数据声明

README、npm 页面和 gallery 描述必须明确说明：

> 安装此 package 后，扩展默认将完整 Pi system prompt、context files 内容、skill 元数据和工具提示信息保存到本地 Pi session。数据不会上传，不会用于遥测，也不会作为捕获消息重新发送给模型。卸载 package 可停止后续捕获；既有 session 数据不会被删除。

首次 extension 加载可以显示一次非阻塞通知：

```text
Pi Session Viewer 已启用 system prompt 捕获。
捕获内容仅保存在本地 session；卸载 package 可停止后续捕获。
```

通知状态不得通过捕获开关实现。可以只在当前 Pi 进程首次加载时显示一次。

## 13. 迁移现有开发安装

当前存在全局软链接：

```text
~/.pi/agent/extensions/pi-session-viewer-system-prompt.ts
```

正式 package 测试和安装前必须移除此链接，否则同一捕获 hook 会加载两次。

迁移步骤：

1. 停止当前开发 Web 服务。
2. 退出所有正在运行的 Pi 进程，或准备执行 `/reload`。
3. 删除手工软链接。
4. 使用本地 package 安装测试：

```bash
pi install /home/hzf/workspace/projects-mine/pi-session-viewer
```

5. 重启 Pi 或执行 `/reload`。
6. 发送一条测试消息。
7. 验证 session 只产生一条初始 prompt 捕获记录。
8. 执行 `/session-viewer on` 验证面板。
9. 执行 `/session-viewer off` 验证 listener 关闭但下一轮仍捕获。

必须保持：

- 既有 `pi-session-viewer.system-prompt` entry 可继续读取。
- 不迁移、不复制、不重写历史 session。
- 不因 package 安装重复捕获同一轮。

## 14. 实施阶段

### 阶段 0：冻结发布信息

任务：

- [ ] 确定 npm package 名称。
- [ ] 确定 npm scope。
- [ ] 确定 Git 仓库 URL。
- [ ] 确定 license。
- [ ] 确定作者信息。
- [ ] 准备 gallery screenshot 或 WebP。
- [ ] 确定首发版本号。

建议默认值：

```text
name: @hzf/pi-session-viewer
license: MIT
version: 0.1.0
```

完成标准：所有 package metadata 均有最终值，不保留占位符。

### 阶段 1：整理源码边界

任务：

- [ ] 建立 `src/extension`、`src/server`、`src/core`、`src/web`。
- [ ] 移动 system prompt 捕获代码。
- [ ] 移动 session parser 和 causal layout 到 core。
- [ ] 前后端共享类型迁入 core。
- [ ] 修正所有导入路径。
- [ ] 保持现有测试先绿后继续。

完成标准：源码目录职责清楚，旧路径无重复实现，全部现有测试通过。

### 阶段 2：实现生产 Web Server

任务：

- [ ] 用 Node `http` 替换生产 Express/Vite middleware。
- [ ] 实现静态资源 MIME 映射。
- [ ] 实现 SPA fallback。
- [ ] 保留只读 session discovery。
- [ ] 实现 token 验证和安全头。
- [ ] 实现随机端口。
- [ ] 实现可重复关闭。

完成标准：生产 server 在无 Vite、无 tsx 环境运行，安全测试通过。

### 阶段 3：接入 Pi Extension 生命周期

任务：

- [ ] 创建唯一 extension 入口。
- [ ] 注册默认捕获 hooks。
- [ ] 注册 `/session-viewer` 命令。
- [ ] 实现 `on|off` 参数。
- [ ] 将 server controller 接入 command。
- [ ] 在 `session_shutdown` 关闭服务。
- [ ] 添加首次加载通知。

完成标准：安装后未开启面板也能捕获；on/off 只影响服务器。

### 阶段 4：生产构建

任务：

- [ ] 配置 Vite 输出到 `dist/web`。
- [ ] 配置 extension bundler 输出到 `dist/extension`。
- [ ] 将 Pi 核心包 external 化。
- [ ] 添加 clean/build/verify/prepack scripts。
- [ ] 删除生产入口对 Vite 和 tsx 的依赖。

完成标准：`npm pack` 后仅使用 tarball 内容即可运行。

### 阶段 5：Package Manifest 与文档

任务：

- [ ] 删除 `private`。
- [ ] 添加 `pi-package` keyword。
- [ ] 添加 `pi.extensions`。
- [ ] 添加 `files`。
- [ ] 添加 peerDependencies。
- [ ] 添加 repository/homepage/bugs/license/author。
- [ ] 添加 gallery image。
- [ ] 重写安装和使用文档。
- [ ] 显著声明敏感数据行为。
- [ ] 记录历史 prompt 限制。

完成标准：npm 页面和 gallery 页面无需阅读源码即可理解全部行为和风险。

### 阶段 6：测试与安全门

任务：

- [ ] 捕获 snapshot/reference 单元测试。
- [ ] prompt 动态变化测试。
- [ ] 历史缺失标记测试。
- [ ] server 状态机测试。
- [ ] command 参数测试。
- [ ] API token 测试。
- [ ] Host/Origin 测试。
- [ ] path traversal 测试。
- [ ] symlink escape 测试。
- [ ] 静态资源测试。
- [ ] Playwright 桌面与窄屏测试。
- [ ] package tarball 安装测试。
- [ ] npm audit。

完成标准：全部发布门通过，没有跳过的安全测试。

### 阶段 7：本地 Package 验收

任务：

```bash
npm run verify
npm pack --dry-run
npm pack
```

在隔离目录安装 tarball，再让 Pi 临时加载解包后的 package：

```bash
tmp_dir="$(mktemp -d)"
npm install --prefix "$tmp_dir" ./scope-pi-session-viewer-0.1.0.tgz
pi -e "$tmp_dir/node_modules/@scope/pi-session-viewer"
```

验收场景：

- [ ] 不启动面板，发送消息后 session 已有 prompt snapshot。
- [ ] `/session-viewer on` 返回本地 URL。
- [ ] 无 token 无法读取 API。
- [ ] 正确 token 能加载 session。
- [ ] `/session-viewer on` 重复执行不产生第二个 listener。
- [ ] `/session-viewer off` 后 URL 失效。
- [ ] off 后发送下一条消息仍产生 prompt capture。
- [ ] 历史会话显示未记录。
- [ ] 新会话显示内容和组成。
- [ ] 卸载或移除临时 package 后不再捕获。

完成标准：所有验收场景均有自动或人工证据。

### 阶段 8：发布与 Catalog 验证

本地发布：

```bash
npm whoami
npm publish --access public
```

如果使用支持 npm trusted publishing 的 CI，再增加 provenance：

```bash
npm publish --access public --provenance
```

发布后：

```bash
pi install npm:@scope/pi-session-viewer@0.1.0
pi list
```

验证：

- [ ] npm tarball 可下载。
- [ ] `pi install` 成功。
- [ ] extension 被发现且只加载一次。
- [ ] gallery 能按 `pi-package` keyword 发现。
- [ ] image 正常显示。
- [ ] README 格式正常。
- [ ] 从干净环境安装后功能完整。

完成标准：公开安装路径与本地 tarball 行为一致。

## 15. 测试矩阵

| 层级 | 重点 | 工具 |
|---|---|---|
| Unit | JSONL、树、prompt 快照、因果轨道 | Vitest |
| Extension | hooks、去重、默认捕获 | Fake ExtensionAPI + Vitest |
| Server | token、Host、路径白名单、关闭 | Node test/Vitest |
| Command | on/off 幂等、错误参数 | Fake command context |
| UI | prompt 内容、组成、缺失状态 | Playwright |
| Responsive | 桌面、390px、抽屉 | Playwright screenshots |
| Package | tarball 文件、无 devDependency | npm pack + isolated install |
| Security | traversal、symlink、无 token | HTTP integration tests |

## 16. 发布验收标准

只有满足以下全部条件才允许发布：

- [ ] 安装 package 后捕获默认启用。
- [ ] 捕获完全不依赖 Web 服务。
- [ ] 不存在 capture on/off 命令。
- [ ] `/session-viewer on|off` 只控制面板服务。
- [ ] System prompt 重复内容按哈希去重。
- [ ] Prompt 变化产生独立快照。
- [ ] 历史轮次明确标记未记录。
- [ ] Web 服务只监听 loopback。
- [ ] API 必须通过随机 token 认证。
- [ ] API 只能读取允许 session 根目录。
- [ ] 无遥测、无外部资源、无上传。
- [ ] `npm install --omit=dev` 后可运行。
- [ ] tarball 不依赖源码目录。
- [ ] 无手工全局软链接造成重复加载。
- [ ] 单元、集成、E2E、安全测试全部通过。
- [ ] npm audit 无中高危生产漏洞。
- [ ] README 明确披露敏感数据捕获。
- [ ] gallery metadata 完整。

## 17. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 用户误以为 off 会停止捕获 | 隐私预期错误 | 命令反馈明确“捕获仍继续” |
| localhost API 被其他页面探测 | 会话内容泄露 | 随机 token、无 CORS、Host 校验、CSP |
| 固定端口冲突 | 面板无法启动 | 使用 port 0 随机端口 |
| 扩展重复加载 | 一轮写两份捕获 | 移除旧软链接，加入重复记录测试 |
| Prompt 体积快速增长 | session 变大 | SHA-256 snapshot/reference 去重 |
| Context file 含密钥 | 本地 session 保存敏感内容 | README 显著披露，严格本地访问 |
| 历史重建不准确 | 用户误判 | 只显示未记录，不推测 |
| Vite/devDependency 泄漏 | 安装后无法运行 | 预构建 dist，tarball 隔离测试 |
| session shutdown 遗留端口 | 后续冲突和孤儿进程 | server controller 可重复关闭，进程检查测试 |
| subagent 未加载 package | 子 prompt 缺失 | 文档限定为“加载本 package 的 Pi runtime” |
| Provider payload 改写不可见 | 与最终线协议存在差异 | UI 和 README 标注捕获边界 |

## 18. 回滚方案

发布前回滚：

- 保留当前源码开发命令。
- 保留 custom entry schema v1。
- Package 分支失败时不修改既有 session。

发布后回滚：

- 发布修复版本，不覆盖已发布版本内容。
- 必要时使用 npm deprecate 标记问题版本。
- 用户执行 `pi remove npm:@scope/pi-session-viewer` 停止后续捕获。
- 已写入 session 的 custom entries 保留且仍可由兼容版本读取。
- 不提供自动删除历史捕获的卸载脚本。

## 19. 待确认发布信息

实施开始前必须由项目所有者确认：

- npm package 名称和 scope。
- Git 仓库地址及公开性。
- License。
- 作者/组织信息。
- 首发版本号采用 `0.1.0` 还是 `1.0.0`。
- Gallery preview 图片 URL。
- `/session-viewer on` 是仅显示 URL，还是同时自动打开浏览器。

推荐默认：

- `@hzf/pi-session-viewer`
- MIT
- `0.1.0`
- 自动打开浏览器，失败时显示 URL
- Web 服务状态仅当前 Pi runtime 有效

## 20. 最终交付物

改造完成后应交付：

- 可发布 npm package。
- Pi extension 生产 bundle。
- 预构建 Web 静态资源。
- `/session-viewer on|off` 命令。
- 默认开启的 system prompt 捕获。
- 安全的本地只读服务。
- 完整 README 和隐私声明。
- Gallery preview。
- 单元、集成、E2E 和安全测试。
- tarball 验收记录。
- 首次 npm 发布和 gallery 验证记录。
