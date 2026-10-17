## Project status

This project is under active development. Prioritize the optimal architecture; backward compatibility is not required.

## File references

Use standard relative paths when referencing internal code or files in Markdown: use `./filename` for files in the same directory and `../` or `../../` for files in parent directories. Avoid `file://`, URL-encoded paths, and `~/`-style paths.

## Agent skills

### Issue tracker

Issues and specs are tracked in this repo's GitHub Issues; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage labels with the matching strings listed in the repo configuration. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context domain docs: read the root `GLOSSARY.md` and relevant ADRs under `docs/adr/`. See `docs/agents/domain.md`.
