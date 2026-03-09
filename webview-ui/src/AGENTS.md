# webview-ui/src/ — React Webview App

Separate Vite + React 19 project. Built independently (`tsc -b && vite build`), output consumed by extension.

## STRUCTURE

```
src/
├── main.tsx              # React entry (createRoot)
├── App.tsx               # Composition root: hooks + components + EditActionBar
├── constants.ts          # ALL webview magic numbers (grid, animation, rendering, camera, zoom, editor)
├── vscodeApi.ts          # acquireVsCodeApi() wrapper
├── notificationSound.ts  # Web Audio API chime (E5→E6) on agent waiting
├── index.css             # Global styles, --pixel-* CSS vars, @font-face pixel font
├── hooks/                # React hooks (message handling, editor actions, keyboard)
├── components/           # UI components (toolbar, zoom, settings modal, debug)
└── office/               # Game engine + editor → see office/AGENTS.md
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| App composition | `App.tsx` | Wires hooks → office canvas + UI overlays |
| Extension messages | `hooks/useExtensionMessages.ts` | Message handler, agent/tool state management |
| Editor state/actions | `hooks/useEditorActions.ts` | Editor callbacks, tool switching |
| Keyboard shortcuts | `hooks/useEditorKeyboard.ts` | Ctrl+Z/Y, R/T/Esc key bindings |
| Bottom toolbar | `components/BottomToolbar.tsx` | "+ Agent", Layout toggle, Settings |
| Settings modal | `components/SettingsModal.tsx` | Export/import layout, sound toggle, debug |
| Zoom controls | `components/ZoomControls.tsx` | +/- zoom (top-right overlay) |

## CONVENTIONS

- `verbatimModuleSyntax` — must use `import type` for type-only imports
- `erasableSyntaxOnly` — no `enum`, use `as const` objects
- `noUnusedLocals` + `noUnusedParameters` — unused code fails build
- Game state is NOT React state — `OfficeState` is imperative, canvas renders via rAF
- UI overlays use pixel art aesthetic: `borderRadius: 0`, `2px solid` borders, hard shadows
- Constants in `constants.ts` — never inline magic numbers in components
- CSS variables in `index.css :root` — `--pixel-bg`, `--pixel-border`, `--pixel-accent`, etc.
