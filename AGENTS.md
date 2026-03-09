# PROJECT KNOWLEDGE BASE

**Updated:** 2026-03-08
**Branch:** main

## OVERVIEW

VS Code extension: pixel art office where OpenCode terminal agents are animated characters. Two-project monorepo — Node.js extension backend (esbuild) + React webview (Vite). Agent activity is tracked by polling OpenCode's SQLite database (`~/.local/share/opencode/opencode.db`) via `sql.js` (pure JS, no WASM). See `CLAUDE.md` for exhaustive architecture reference.

## STRUCTURE

```
pixel-agents-opencode/
├── src/                    # Extension backend (VS Code API, Node.js) → see src/AGENTS.md
├── webview-ui/             # Separate npm project (React + Vite) → see webview-ui/src/AGENTS.md
│   └── src/office/         # Game engine, canvas, editor → see office/AGENTS.md
├── scripts/                # Asset extraction pipeline → see scripts/AGENTS.md
├── esbuild.js              # Custom bundler: src/extension.ts → dist/extension.js + copies assets
├── CLAUDE.md               # Deep technical reference (architecture, protocols, lessons learned)
└── package.json            # Root: build orchestration, lint-staged, husky
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Extension lifecycle | `src/extension.ts` | activate/deactivate, provider registration |
| Webview ↔ extension messages | `src/PixelAgentsViewProvider.ts` + `webview-ui/src/hooks/useExtensionMessages.ts` | postMessage protocol |
| Agent terminal management | `src/agentManager.ts` | Launch `opencode`, remove, restore, persist |
| DB polling (activity tracking) | `src/dbPoller.ts` | Read-only SQLite polls via `sql.js` (sql-asm.js, pure JS) at 500ms intervals |
| Transcript parsing | `src/transcriptParser.ts` | OpenCode `part.data` JSON → tool/text/step events for webview |
| Game rendering | `webview-ui/src/office/engine/renderer.ts` | Canvas, z-sort, overlays |
| Character AI/FSM | `webview-ui/src/office/engine/characters.ts` | idle/walk/type states |
| Layout editor | `webview-ui/src/office/editor/` | Tools, undo/redo, toolbar |
| Furniture catalog | `webview-ui/src/office/layout/furnitureCatalog.ts` | Dynamic from loaded assets |
| Sprite system | `webview-ui/src/office/sprites/` | Pixel data + cached canvas rendering |
| Add constants | `src/constants.ts` (backend) or `webview-ui/src/constants.ts` (webview) | NEVER inline magic numbers |
| CSS variables | `webview-ui/src/index.css` `:root` | `--pixel-*` custom properties |

## CONVENTIONS

- **No `enum`** — use `as const` objects (`erasableSyntaxOnly`)
- **`import type`** required for type-only imports (`verbatimModuleSyntax`)
- **Constants centralized** — backend in `src/constants.ts`, webview in `webview-ui/src/constants.ts`, CSS in `index.css :root`
- **Import sorting** — `eslint-plugin-simple-import-sort` enforced (warn)
- **Formatting** — Prettier: single quotes, 100 char width, trailing commas, LF
- **Two `npm install`s** — root AND `webview-ui/` each have separate `node_modules`
- **Module system** — source uses ESM imports with `.js` extensions; esbuild bundles to CJS for VS Code host
- **Game state** — imperative `OfficeState` class, NOT React state. Canvas re-renders via rAF loop
- **Pixel art UI** — sharp corners (`borderRadius: 0`), `2px solid` borders, hard shadows, pixel font

## ANTI-PATTERNS

- **Never inline constants** — all magic numbers go in centralized constants files
- **Never use `enum`** — TypeScript `erasableSyntaxOnly` is enabled
- **Never suppress types** — no `as any`, `@ts-ignore`, `@ts-expect-error`
- **Never `fs.watch` alone** — always pair with polling backup (unreliable on Windows)
- **Never lift game state into React** — imperative OfficeState + rAF loop is deliberate for canvas perf
- **Unused locals/params fail build** — `noUnusedLocals` + `noUnusedParameters` enabled

## COMMANDS

```bash
# Install (both projects)
npm install && cd webview-ui && npm install && cd ..

# Full build (type-check → lint → esbuild → vite)
npm run build

# Production package (minified)
npm run package

# Dev watch (extension + types)
npm run watch

# Dev webview only
cd webview-ui && npm run dev

# Lint
npm run lint              # extension src
npm run lint:webview      # webview src

# Format
npm run format            # apply prettier
npm run format:check      # verify formatting

# Asset pipeline (requires paid tileset)
npm run import-tileset
```

## NOTES

- **No tests** — no test scripts or test framework configured
- **No CI/CD** — no GitHub Actions, no deployment pipeline
- **Pre-commit hooks** — husky + lint-staged auto-formats and lints on commit
- **DevContainer available** — installs opencode-ai + bun, mounts host auth
- Build MUST complete before F5 debug (VS Code loads `dist/extension.js`)
- `vscode:prepublish` → `npm run package` (for marketplace publishing)
- Asset pipeline is interactive and requires third-party paid tileset
