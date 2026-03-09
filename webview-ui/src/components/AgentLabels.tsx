import { useEffect, useState } from 'react';

import type { SubagentCharacter } from '../hooks/useExtensionMessages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { CharacterState, TILE_SIZE } from '../office/types.js';

interface LabelInfo {
  id: number;
  screenX: number;
  screenY: number;
  isWaiting: boolean;
  isActive: boolean;
  isSub: boolean;
  labelText: string;
}

interface AgentLabelsProps {
  officeState: OfficeState;
  agents: number[];
  agentStatuses: Record<number, string>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  subagentCharacters: SubagentCharacter[];
}

export function AgentLabels({
  officeState,
  agents,
  agentStatuses,
  containerRef,
  zoom,
  panRef,
  subagentCharacters,
}: AgentLabelsProps) {
  const [labels, setLabels] = useState<LabelInfo[]>([]);

  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const el = containerRef.current;
      const pan = panRef.current;
      if (el && pan) {
        const rect = el.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const canvasW = Math.round(rect.width * dpr);
        const canvasH = Math.round(rect.height * dpr);
        const layout = officeState.getLayout();
        const mapW = layout.cols * TILE_SIZE * zoom;
        const mapH = layout.rows * TILE_SIZE * zoom;
        const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(pan.x);
        const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(pan.y);

        const subLabelMap = new Map<number, string>();
        for (const sub of subagentCharacters) {
          subLabelMap.set(sub.id, sub.label);
        }

        const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];
        const next: LabelInfo[] = [];

        for (const id of allIds) {
          const ch = officeState.characters.get(id);
          if (!ch) continue;
          const sittingOffset = ch.state === CharacterState.TYPE ? 6 : 0;
          const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
          const screenY = (deviceOffsetY + (ch.y + sittingOffset - 24) * zoom) / dpr;
          const status = agentStatuses[id];
          next.push({
            id,
            screenX,
            screenY,
            isWaiting: status === 'waiting',
            isActive: ch.isActive,
            isSub: ch.isSubagent,
            labelText: subLabelMap.get(id) || `Agent #${id}`,
          });
        }

        setLabels(next);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [officeState, agents, agentStatuses, containerRef, zoom, panRef, subagentCharacters]);

  return (
    <>
      {labels.map(({ id, screenX, screenY, isWaiting, isActive, isSub, labelText }) => {
        let dotColor = 'transparent';
        if (isWaiting) {
          dotColor = 'var(--vscode-charts-yellow, #cca700)';
        } else if (isActive) {
          dotColor = 'var(--vscode-charts-blue, #3794ff)';
        }

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - 16,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              pointerEvents: 'none',
              zIndex: 40,
            }}
          >
            {dotColor !== 'transparent' && (
              <span
                className={isActive && !isWaiting ? 'pixel-agents-pulse' : undefined}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: dotColor,
                  marginBottom: 2,
                }}
              />
            )}
            <span
              style={{
                fontSize: isSub ? '16px' : '18px',
                fontStyle: isSub ? 'italic' : undefined,
                color: 'var(--vscode-foreground)',
                background: 'rgba(30,30,46,0.7)',
                padding: '1px 4px',
                borderRadius: 2,
                whiteSpace: 'nowrap',
                maxWidth: isSub ? 120 : undefined,
                overflow: isSub ? 'hidden' : undefined,
                textOverflow: isSub ? 'ellipsis' : undefined,
              }}
            >
              {labelText}
            </span>
          </div>
        );
      })}
    </>
  );
}
