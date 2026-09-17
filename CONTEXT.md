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
