# engine/ — Game Loop & Renderer

Core runtime: game state management, character FSM, canvas rendering, visual effects.

## FILES

| File | Role | Lines |
|------|------|-------|
| `officeState.ts` | Game world: layout, characters, seats, selection, sub-agents, furniture instance rebuilding | 700 |
| `renderer.ts` | Canvas rendering: tiles, z-sorted entities, overlays, edit UI, speech bubbles | 669 |
| `characters.ts` | Character FSM: idle→walk→type states, wander AI, BFS pathfinding integration | 339 |
| `gameLoop.ts` | `requestAnimationFrame` loop with delta time (capped 0.1s) | small |
| `matrixEffect.ts` | Matrix-style digital rain spawn/despawn animation (0.3s, 16 columns) | small |

## KEY PATTERNS

- **OfficeState** is the single source of truth for the game world. Not React state — mutated imperatively.
- **Character FSM**: active (pathfind to seat → typing/reading animation by tool type) or idle (wander randomly, return to seat after `wanderLimit` moves). 4-directional sprites; left = flipped right.
- **Renderer**: no `ctx.scale(dpr)`. Pixel-perfect zoom = integer device-pixels-per-sprite-pixel (1x–10x). Z-sort all entities by Y coordinate.
- **Sitting offset**: characters shift down 6px in TYPE state to visually sit in chair.
- **Matrix effect**: per-pixel rendering replaces cached sprite draw during spawn/despawn. FSM paused during effect. Despawning characters skip hit-testing.
- **Auto-state**: `rebuildFurnitureInstances()` swaps electronics to ON sprites when active agent faces nearby desk. Render-time only — does NOT modify saved layout.
- **Sub-agents**: negative IDs (from -1 down), same palette as parent, spawn at closest free seat (Manhattan distance).

## CONVENTIONS

- Delta time capped at 0.1s to prevent teleporting on tab-resume
- Camera follow (`cameraFollowId`) is separate from `selectedAgentId`
- Pan via middle-mouse drag; cleared on manual pan
- `pickDiversePalette()` ensures first 6 agents get unique skins; beyond 6, random hue shift (45–315°)
