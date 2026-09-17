# Pi Session Viewer

A local, read-only web inspector for [Pi](https://github.com/earendil-works/pi) coding-agent sessions. Visualizes multi-turn timelines, tool-call causality, and captured system prompt compositions.

## Install

```bash
pi install npm:@hfrancisla/pi-session-viewer
```

Restart Pi or run `/reload`. The extension loads automatically and begins capturing system prompts on the next turn.

## Usage

```text
/session-viewer       # Start viewer (alias for on)
/session-viewer on    # Start viewer and open in browser
/session-viewer off   # Stop viewer (system prompt capture continues)
```

- Starting the viewer opens a local tokenized dashboard in your browser.
- Session switches (`/new`, `/resume`, `/fork`) require running `/session-viewer on` again.
- Discover sessions directly from Pi's storage or import any `.jsonl` session file via the browser.

## Key Features

- **Timeline & Causality**: Tracks user turns, thinking blocks, and paired tool calls with visual causality rails.
- **System Prompt Breakdown**: Inspects prompt structure across base instructions, tool definitions, skills, and context files.
- **Multi-Project Catalog**: Groups sessions by project working directory with automatic path collision disambiguation.
- **Local JSONL Import**: Inspect arbitrary session files offline via file drag-and-drop.

## Security & Privacy

- **Local Only**: Listens strictly on `127.0.0.1` with a per-instance random bearer token. No cloud sync, telemetry, or remote access.
- **Read-Only**: The web interface cannot mutate sessions or execute commands.
- **Capture Scope**: Saves system prompts, skill metadata, and context file snapshots to local session files. Does **not** record API keys, request headers, or credentials.
- **Historical Sessions**: Turns recorded prior to package installation display as *unrecorded*; past prompts are never guessed.

## Development

```bash
npm install
npm run dev        # Web dev server
npm test           # Unit & integration tests
npm run build      # Build web assets and extension bundle
npm run verify     # Full verification suite
```

Session directory resolution order: `PI_CODING_AGENT_SESSION_DIR` → `~/.pi/agent/settings.json` → `~/.pi/agent/sessions`.
