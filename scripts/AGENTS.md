# scripts/ — Asset Extraction Pipeline

7-stage pipeline for extracting and preparing furniture/character sprites from a third-party tileset.

## PIPELINE STAGES

| Stage | File | Purpose |
|-------|------|---------|
| 0 | `0-import-tileset.ts` | Interactive CLI wrapper — entry point (`npm run import-tileset`) |
| 1 | `1-detect-assets.ts` | Flood-fill asset detection from tileset PNG |
| 2 | `2-asset-editor.html` | Browser UI for position/bounds editing |
| 3 | `3-vision-inspect.ts` | Claude vision API auto-metadata (uses claude-opus model) |
| 4 | `4-review-metadata.html` | Browser UI for metadata review |
| 5 | `5-export-assets.ts` | Export individual PNGs + `furniture-catalog.json` |
| — | `export-characters.ts` | Bake `CHARACTER_PALETTES` into character sprite PNGs |
| — | `generate-walls.js` | Generate `walls.png` (4×4 grid, 16×32 auto-tile pieces) |
| — | `wall-tile-editor.html` | Browser UI for editing wall tile appearance |
| — | `asset-manager.html` | Unified editor (stages 2+4 combined), File System Access API |
| — | `jsonl-viewer.html` | JSONL transcript viewer utility |

## NOTES

- Pipeline requires a **paid third-party tileset** (not included in repo)
- Stages 2, 4, and asset-manager are browser-based HTML tools (open in browser, not CLI)
- Stage 3 calls Claude vision API — requires Anthropic API key
- Output goes to `webview-ui/public/assets/` → copied to `dist/assets/` by esbuild
- Scripts run via `tsx` (TypeScript execution without compilation)
- `furniture-catalog.json` is the key output: id, name, category, footprint, rotation/state groups
- Asset naming: `{BASE}[_{ORIENTATION}][_{STATE}]` (e.g., `MONITOR_FRONT_OFF`)
