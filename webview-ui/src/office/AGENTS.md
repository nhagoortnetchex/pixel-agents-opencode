# office/ — Game Engine & Editor

Core pixel art office simulation: canvas rendering, character AI, layout editing, sprite system.

## STRUCTURE

```
office/
├── types.ts          # Interfaces (OfficeLayout, Character, FloorColor) + re-exports from constants.ts
├── toolUtils.ts      # STATUS_TO_TOOL mapping, extractToolName(), defaultZoom()
├── colorize.ts       # Dual-mode: Colorize (grayscale→HSL) + Adjust (HSL shift)
├── floorTiles.ts     # Floor sprite storage + colorized cache (7 patterns)
├── wallTiles.ts      # Wall auto-tile: 16 bitmask sprites, 4-bit N/E/S/W
├── engine/           # Game loop, state, renderer, characters → see engine/AGENTS.md
├── editor/           # Layout editing tools, undo/redo, toolbar
├── layout/           # Serialization, furniture catalog, pathfinding
├── sprites/          # Pixel data arrays + cached canvas rendering
└── components/       # OfficeCanvas.tsx (main canvas) + ToolOverlay.tsx
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Canvas rendering + mouse events | `components/OfficeCanvas.tsx` | Resize, DPR, hit-testing, drag-to-move, edit interactions |
| Activity label overlay | `components/ToolOverlay.tsx` | Status label above hovered/selected character |
| Floor/wall paint ops | `editor/editorActions.ts` | Pure layout operations: paint, place, remove, move, rotate |
| Editor imperative state | `editor/editorState.ts` | Tools, ghost preview, selection, undo/redo stack (50 levels) |
| Editor toolbar/palette | `editor/EditorToolbar.tsx` | React toolbar for floor/wall/furniture tools, HSBC sliders |
| Furniture catalog | `layout/furnitureCatalog.ts` | Dynamic from loaded assets, rotation/state groups |
| Layout ↔ runtime | `layout/layoutSerializer.ts` | Serialize/deserialize: tileMap, furniture instances, seats, blocked tiles |
| BFS pathfinding | `layout/tileMap.ts` | Walkability grid, pathfind with per-character seat unblocking |
| Sprite pixel data | `sprites/spriteData.ts` | Characters (6 palettes), furniture, tiles, bubbles — 1122 lines |
| Sprite → canvas cache | `sprites/spriteCache.ts` | SpriteData → offscreen canvas, per-zoom WeakMap, outline sprites |

## KEY CONCEPTS

- **Z-sorting**: all entities sorted by Y. Characters use `y + TILE_SIZE/2 + 0.5`. Non-back chairs: `(row+1)*TILE_SIZE`. Back chairs: `+1` to render in front.
- **Colorize module**: `colorize?` flag selects mode. Colorize = grayscale→HSL (floors). Adjust = shift original HSL (furniture, character hue).
- **Wall auto-tile**: 4-bit bitmask (N=1 E=2 S=4 W=8). Sprites are 16×32 (extend 16px above tile for 3D face).
- **Surface placement**: `canPlaceOnSurfaces` items overlap desk tiles. Z-sort: `max(spriteBottom, deskZY + 0.5)`.
- **Background tiles**: top N rows of furniture are walkable/placeable. Render behind via lower zY.
- **Grid expansion**: ghost border 1 tile outside grid; click → `expandLayout()`. Max 64×64.

## ANTI-PATTERNS

- Never modify `OfficeState` from React render — use hooks that call imperative methods
- `editorState.selectedFurnitureUid` is imperative — must call `onEditorSelectionChange()` to trigger React re-render
- Floor tiles are ALWAYS colorized (grayscale patterns need Photoshop-style Colorize)
- Speech bubbles always render on top of characters (render order assumption in renderer)
