# src/ — Extension Backend

VS Code extension host code (Node.js). Bundled by esbuild → `dist/extension.js` (CJS).

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Extension activation | `extension.ts` | `activate()` registers provider + commands |
| Webview lifecycle | `PixelAgentsViewProvider.ts` | HTML generation, message dispatch, asset loading, layout watcher |
| Terminal management | `agentManager.ts` | Launch `opencode` in terminal, session discovery, remove, restore, persist to workspaceState |
| DB polling | `dbPoller.ts` | Read-only SQLite via `sql.js` (sql-asm.js, pure JS), polls `~/.local/share/opencode/opencode.db` at 500ms |
| Transcript parsing | `transcriptParser.ts` | OpenCode `part.data` JSON → tool/text/step-finish events for webview |
| Layout file I/O | `layoutPersistence.ts` | `~/.pixel-agents/layout.json`, atomic write (`.tmp` + rename), cross-window watch |
| Permission/wait timers | `timerManager.ts` | 7s permission timeout, sub-agent timer forwarding |
| Shared types | `types.ts` | `AgentState`, `PersistedAgent` interfaces |
| Backend constants | `constants.ts` | ALL timing values, truncation limits, VS Code IDs, OpenCode DB paths |
| sql.js type declarations | `sql-js.d.ts` | Minimal types for `sql.js/dist/sql-asm.js` (avoids `@types/emscripten` conflict) |

## CONVENTIONS

- Imports use `.js` extensions (ESM-style) despite CJS bundle output
- One file per responsibility — flat directory, no subdirs
- `postMessage` is the ONLY communication with webview (no shared state)
- Persistence: agents → `workspaceState`, layout → filesystem, sound → `globalState`
- sql.js uses the `sql-asm.js` entry (pure JS, no WASM file needed at runtime)

## ANTI-PATTERNS

- Never touch seat assignments in `persistAgents()` — separate storage key
- Always send saved layout on webview ready (even if null for default)
- `step-finish` with `reason: "stop"` signals turn end — need text-idle timer fallback for text-only turns
- Never use `sql.js` default import (requires WASM file) — always use `sql.js/dist/sql-asm.js`
