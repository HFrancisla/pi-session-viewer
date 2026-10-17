# Pi Session Viewer

A local, read-only observability inspector for Pi coding-agent sessions, prompt snapshots, and causality analysis.

## Language

**Session**:
A recorded linear or branching execution history of a Pi agent run, stored as a series of JSONL entries.
_Avoid_: log, trace, run, chat

**Turn**:
A single interaction round initiated by a user message and containing all resulting assistant replies, thinking processes, and tool executions.
_Avoid_: round, step, iteration

**Project**:
A logical collection of sessions sharing the same normalized working directory (`cwd`).
_Avoid_: workspace, directory, folder, repository

**Session Catalog**:
The domain index and aggregator of discovered session files and their associated projects.
_Avoid_: session list, session registry, project manager

**Disambiguated Project Name**:
A minimal distinguishing path label assigned to a project when its directory basename collides with another project in the catalog.
_Avoid_: full path, alias, display label

**Prompt Format**:
The layout Pi uses to assemble a system prompt. Pi >= 0.86 wraps every section except the preamble in a tag (`tagged`: `<tools>`, `<rules>`, `<docs>`, `<addendum>`, `<project_context>`, `<skills>`, `<cwd>`); Pi <= 0.85 emitted plain headers (`legacy`: `Available tools:`, `Guidelines:`, `Pi documentation (read only ...):`). A prompt matching neither is `unknown`, never silently merged into another section.
_Avoid_: prompt version, prompt style, prompt schema

**Section Claim**:
The region of the source prompt a parsed section is built from, recorded as `ranges`. Claims never overlap and cover every non-whitespace character exactly once, so a parse can be proven lossless.
_Avoid_: offset, span, slice

**Context Edit**:
Pi's append-only `context_edit` entry. It changes only future model context: `replacement: null` omits the target entry from context, a non-null replacement substitutes its content. The target entry itself is never modified.
_Avoid_: message edit, rewrite, patch

**Usage Entry**:
Pi's `usage` entry: model-attributed usage that is not attached to an assistant message (for example `kind: "cache_warm"`). It does not participate in LLM context.
_Avoid_: cost record, billing entry

**Prompt Section**:
One named block of Pi's system prompt. Pi's builder emits `tools`, `rules`, `docs`, `addendum`, `project_context`, `skills`, and `cwd` for standard options; its built-in extensions append their own afterwards through the `sections` option (`mcp_servers` from the MCP extension). Both groups are modelled and shown as their own cards; anything else is an Unrecognized Section.
_Avoid_: prompt block, prompt part

**Context Projection**:
What the model actually received on one branch, computed by Pi's own `buildSessionProjection`. It applies `context_edit` omissions/replacements and compaction, so it differs from the session file: the file is the raw append-only history, the projection is the context.
_Avoid_: context state, prompt state, effective history

**Context Edit Link**:
The connection between a `context_edit` and the entries it keeps out of context: the target entry (named by a content preview, jumpable) plus any other entries the same edit removed. The viewer shows both ends, so "why is this not in context" and "what did that edit remove" are answerable in place.
_Avoid_: edit reference, message pointer

**Context Exclusion**:
A context-producing entry on the shown branch that contributes no message to the model. `omitted` means a `context_edit` removed it; `not-in-context` means another cause (a compaction boundary, or a tool result whose call left the context). The viewer marks the raw record instead of hiding it.
_Avoid_: hidden entry, deleted message, dropped row

**Subagent Target Resolution**:
A subagent reference can name either the runnable run session or pi-subagents' transcript mirror. The viewer tries the runnable session first (`<parent-session-dir>/<runId>/run-0/session.jsonl`) and falls back to the mirror, and only navigates when the file really is a Pi session: a pi-subagents transcript is not, so the viewer keeps the current session and says so.
_Avoid_: subagent link, child path

**Action Error**:
A failure that concerns one action rather than the open session (a subagent jump whose artifacts are gone, for example). It is reported in a dismissible strip above the timeline; the session on screen is never replaced by it.
_Avoid_: load error, fatal error, session error

**Unrecognized Section**:
A top-level tag Pi emitted that this viewer does not model. It is reported in `unrecognizedSections` and still shown as its own item, so a new Pi section surfaces instead of being absorbed.
_Avoid_: unknown block, extra section

## Verification Gates

Expectations come from Pi, not from this repository:

- `tests/pi-contract.test.ts` builds prompts with the installed `@earendil-works/pi-coding-agent`, compares the copied tool snippets/guidelines/section names against Pi's own exports, and fails when the committed `current-*.json` fixture no longer matches the installed Pi.
- `tests/fixtures/prompts/*.json` are generated by Pi's `buildSystemPrompt()`. Regenerate with `npm run fixtures:refresh` after reviewing the parser; the frozen `legacy-0.85.1-*.json` pair covers the pre-0.86 header layout.
- `tests/pi-entry-contract.test.ts` reads Pi's own `docs/session-format.md` from the installed package and fails when Pi documents an entry type the parser does not model, or when a documented example parses with an `unknown-type`/`invalid-entry` warning.
- `tests/pi-tool-provenance-contract.test.ts` builds `sourceInfo` values with Pi's own `createSyntheticSourceInfo`/`BUILTIN_PATH_PREFIX`/`getSyntheticPathSource` and asserts the viewer classifies and labels them the same way, including the synthetic `<sdk:...>` and `<inline:...>` paths that name no file.
- `tests/pi-contract.test.ts` also pins the section set: the sections Pi's builder emits for standard options must equal `PI_SECTION_TAG_NAMES`, and the section Pi's MCP extension adds must equal `PI_EXTENSION_SECTION_NAMES` and parse into its own card. Adding a section in Pi fails these tests until the viewer models it.
- `tests/pi-context-projection-contract.test.ts` compares the viewer's projection against Pi's own `buildSessionProjection` on every branch of up to 200 real sessions (skipped visibly where no sessions exist), and asserts the fixture omissions match Pi's zero-message entries exactly. The viewer never reimplements the projection: `src/server/context-projection.ts` loads Pi's function, and reports nothing when Pi cannot be loaded.
- The same contract test also groups Pi's exclusions per edit and compares that grouping with the links the viewer renders (`event.contextEdit.affectedEntryIds`), so a link can never point at an entry Pi did not actually remove.
- `npm run check:sessions` runs the parser over this machine's real sessions: it uses the catalog's own `walkSessionFiles` rule for entry-type checks (so it verifies what the viewer can show), additionally parses every captured system prompt including files the catalog excludes, and exits non-zero on unknown entry types, unknown sections, unclaimed text, or session parse failures. Run it after upgrading Pi.
