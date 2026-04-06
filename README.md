# Ahaji Claude Code Setup

This folder contains ready-to-use markdown files for running Claude Code on the Ahaji local Escape Room Game Master project.

## Files
- `CLAUDE.md` → project rules, constraints, and working style
- `PROJECT_SPEC.md` → product requirements and behavior spec
- `START_PROMPT.md` → the main prompt to start implementation
- `ITERATION_PROMPTS.md` → follow-up prompts for polish, bug fixing, and cleanup

## Recommended Use
1. Put `CLAUDE.md` in the project root.
2. Keep `PROJECT_SPEC.md` in the root as the detailed product reference.
3. Start Claude Code using the content inside `START_PROMPT.md`.
4. After the initial build, use prompts from `ITERATION_PROMPTS.md` for refinement.

## Suggested Order
- first run: `START_PROMPT.md`
- second run: bug fixing prompt
- third run: UI polish prompt
- fourth run: code cleanup prompt

## Notes
This setup is intentionally strict so Claude Code stays focused on:
- local-only MVP
- same-device usage
- no backend
- no database
- no framework
- no feature creep
