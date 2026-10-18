# Pi Session Viewer

A read-only viewer for Pi sessions that presents a session timeline and details for a selected event.

## Sessions and projects

**Session**:
A recorded linear or branching execution history of a Pi agent run, stored as a series of JSONL entries.
_Avoid_: log, trace, run, chat

**Project**:
A logical collection of Sessions sharing the same normalized working directory (`cwd`).
_Avoid_: workspace, directory, folder, repository

**Session Catalog**:
The index of top-level Pi Sessions grouped by Project. It excludes child Sessions identified by their parent relationship or known subagent origin, plus transcript mirrors, which are not Sessions. Membership determines standalone listing only; a child Session may still be opened from a reference in its parent Session.
_Avoid_: session list, session registry, project manager

## Timeline and selection

**Visible event**:
A session event included by the selected branch and the current event-kind filters. Visibility in the timeline is independent from selection in the Inspector.

**Selected event**:
The session event whose details the Inspector presents. It remains selected when its timeline row is hidden by a filter; an explicit jump to it makes its event kind visible.

**Focused event**:
The visible timeline event currently targeted by keyboard navigation. It may differ from the selected event, and moving focus alone does not change the Inspector selection.

**Session View**:
The current presentation of one Session on a selected branch. Event-kind filters determine its Visible events, while the Selected event drives the Inspector and the Focused event remains independent.
