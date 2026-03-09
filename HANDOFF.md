# Debugging Handoff — Agent Activity Detection

## Status: IN PROGRESS

The extension detects tool completions (green checkmarks) but does NOT show the agent as "active" during tool use. The agent stays "Idle".

## Root Cause Chain (confirmed)

1. **WAL blindness** (FIXED) — sql.js can't read SQLite WAL data. Fixed by running `sqlite3 PRAGMA wal_checkpoint(PASSIVE)` before every DB read when WAL file exists. See `openDbReadonly()` in `src/dbPoller.ts`.

2. **WAL checkpoint frequency** (FIXED) — Was only checkpointing on WAL mtime change. Now checkpoints on every poll when WAL exists.

3. **Single-row tool updates** (FIXED) — OpenCode updates tool parts in-place (`running` → `completed` in same row). By the time we poll at 500ms, most tools are already `completed`. Fixed `processToolPart()` in `src/transcriptParser.ts` to send `agentToolStart` + delayed `agentToolDone` for completed tools we never saw as `running`.

4. **CURRENT BLOCKER: Polls return no results** — Despite fixes #1-3, the poll query returns 0 rows during active agent use. Debug logging was added to `pollAgentParts()` in `src/dbPoller.ts` but not yet tested. The user needs to restart the extension host and share logs showing whether `Poll agent 4: no results` or `Poll agent 4: N rows found` appears.

## What To Do Next

1. **Restart Extension Host** and check console for `Poll agent 4:` log lines during active tool use
2. If "no results" — the WAL checkpoint isn't flushing data, or `lastPartTime` is wrong. Check:
   - Is `checkpointWal()` actually running? (add a log to it)
   - What is `agent.lastPartTime` vs current DB timestamps?
   - Run `sqlite3 ~/.local/share/opencode/opencode.db "PRAGMA wal_checkpoint(PASSIVE);"` manually then check if sql.js can read new data
3. If "N rows found" but no `tool flash:` — the issue is in `processPartRecord()` routing or the `completed` tool path
4. After fix confirmed: remove all `console.log` debug lines from `dbPoller.ts` and `agentManager.ts`

## Debug Logging Currently In Place

- `src/dbPoller.ts` — `pollAgentParts()` logs row count or "no results" on every poll
- `src/agentManager.ts` — Restore/discovery logging
- `src/transcriptParser.ts` — `tool flash:` for completed-without-running tools, `tool start:` / `tool done:` for normal flow

## Build & Install

```bash
cd /workspaces/working/pixel-agents-opencode
npm run build && npx vsce package && code --install-extension pixel-agents-1.0.4.vsix --force
```
Then: "Developer: Restart Extension Host" (NOT Reload Window — Codespaces caches old modules)

Version was bumped to 1.0.4 to force cache invalidation. Bump again if Codespaces loads stale code.

## Key Files Modified

- `src/dbPoller.ts` — WAL checkpoint, DB caching, poll debug logging
- `src/transcriptParser.ts` — Handle already-completed tools
- `src/agentManager.ts` — Restore flow, session discovery
- `src/PixelAgentsViewProvider.ts` — Restore ordering, cleanup
- `src/types.ts` — `lastSeenPartIds` for dedup
- `src/constants.ts` — `RESTORE_LOOKBACK_MS`
- `src/assetLoader.ts` — PNG bounds check
- `webview-ui/src/components/AgentLabels.tsx` — Ref-during-render fix
- `package.json` — Version 1.0.4

## DB Details

- Path: `~/.local/share/opencode/opencode.db`
- WAL: `~/.local/share/opencode/opencode.db-wal`
- Active session: `ses_33006c526ffe39VYoor2TUN1XG` (directory=/workspaces/working)
- OpenCode updates tool parts IN-PLACE (single row, status overwrites from running→completed)
