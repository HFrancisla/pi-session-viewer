# Pi Session Viewer

`@hfrancisla/pi-session-viewer` is a local, read-only inspector for Pi coding-agent sessions and the system prompts captured by this package.

## Install

```bash
pi install npm:@hfrancisla/pi-session-viewer
```

Restart Pi or run `/reload`, then send the next message. The extension is loaded by Pi and system-prompt capture is enabled automatically.

## Use

```text
/session-viewer on
/session-viewer off
```

`on` starts one loopback-only viewer instance on an operating-system-assigned port and displays a tokenized URL. It may open the default browser. Running `on` again reuses the same instance.

`off` stops only the viewer. System-prompt capture continues; uninstalling the package stops future capture. Pi session replacement (`/new`, `/resume`, `/fork`, or `/reload`) requires running `on` again.

The viewer can discover sessions from Pi's configured session directory, switch branches, inspect tool-call causality, and open a JSONL file directly with the browser File API.

## Local data and privacy

> Installing this package enables the extension to save the complete Pi system prompt, context-file contents, skill metadata, and tool prompt information to the local Pi session by default. Data is not uploaded, is not used for telemetry, and is not sent back to the model as a captured message. Uninstalling the package stops future capture; existing session data is not deleted.

The captured entry uses `customType = pi-session-viewer.system-prompt` and schema version `1`. Repeated prompts are stored as SHA-256-backed references after their first complete snapshot. The package does not save full provider request payloads, request headers, credentials, or native tool JSON Schema.

The viewer listens only on `127.0.0.1`, requires a per-instance bearer token, rejects non-local Host/Origin requests, and exposes read-only APIs. The token is kept in the URL fragment, moved to the current tab's `sessionStorage`, and removed from the address bar.

Sessions created before the package was installed cannot have their historical system prompts reconstructed accurately. Those turns are shown as **系统提示词未记录**; current files, skills, or tool configuration are never substituted as historical content.

## Development

```bash
npm install
npm run dev
npm test
npm run test:ui
npm run build
npm run verify
```

The development server uses `PI_CODING_AGENT_SESSION_DIR` when set, then `~/.pi/agent/settings.json`, then `~/.pi/agent/sessions`. Production package runtime is prebuilt under `dist/` and does not require Vite, TypeScript, or `tsx`.

Before testing the package, remove any old manual link such as `~/.pi/agent/extensions/pi-session-viewer-system-prompt.ts`; otherwise the capture hook can load twice. Use `pi install /path/to/pi-session-viewer` and `/reload` to test the package entrypoint.

## Scope

This package is intended for the Pi runtime that loads it. It does not provide cloud access, telemetry, session mutation, provider-payload replay, or guaranteed capture for third-party subagents that do not load the package.
