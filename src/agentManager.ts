import * as path from 'path';
import * as vscode from 'vscode';

import {
  RESTORE_LOOKBACK_MS,
  SESSION_DISCOVERY_INTERVAL_MS,
  TERMINAL_NAME_PREFIX,
  WORKSPACE_KEY_AGENT_SEATS,
  WORKSPACE_KEY_AGENTS,
} from './constants.js';
import {
  discoverMostRecentSession,
  discoverSessions,
  initDbPoller,
  startDbPolling,
  stopDbPolling,
} from './dbPoller.js';
import { migrateAndLoadLayout } from './layoutPersistence.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './timerManager.js';
import type { AgentState, PersistedAgent } from './types.js';

export async function launchNewTerminal(
  nextAgentIdRef: { current: number },
  nextTerminalIndexRef: { current: number },
  agents: Map<number, AgentState>,
  activeAgentIdRef: { current: number | null },
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  pollTimers: Map<number, ReturnType<typeof setInterval>>,
  sessionDiscoveryTimerRef: { current: ReturnType<typeof setInterval> | null },
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
  folderPath?: string,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  const cwd = folderPath || folders?.[0]?.uri.fsPath;
  const isMultiRoot = !!(folders && folders.length > 1);
  const idx = nextTerminalIndexRef.current++;
  const terminal = vscode.window.createTerminal({
    name: `${TERMINAL_NAME_PREFIX} #${idx}`,
    cwd,
  });
  terminal.show();
  terminal.sendText('opencode');

  await initDbPoller();

  const launchTime = Date.now();
  const id = nextAgentIdRef.current++;
  const folderName = isMultiRoot && cwd ? path.basename(cwd) : undefined;
  const agent: AgentState = {
    id,
    terminalRef: terminal,
    sessionId: '',
    lastPartTime: launchTime,
    lastSeenPartIds: new Set(),
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    folderName,
  };

  agents.set(id, agent);
  activeAgentIdRef.current = id;
  persistAgents();
  console.log(`[Pixel Agents] Agent ${id}: created for terminal ${terminal.name}`);
  webview?.postMessage({ type: 'agentCreated', id, folderName });

  const discoveryTimer = setInterval(() => {
    if (!agents.has(id)) {
      clearInterval(discoveryTimer);
      return;
    }
    if (agent.sessionId) return;

    const workspaceDir = cwd || '';
    const sessions = discoverSessions(workspaceDir);
    const newSession = sessions.find((s) => s.timeCreated >= launchTime);

    if (newSession) {
      agent.sessionId = newSession.id;
      agent.lastPartTime = launchTime;
      console.log(`[Pixel Agents] Agent ${id}: discovered session ${newSession.id}`);
      persistAgents();
      startDbPolling(id, agents, waitingTimers, permissionTimers, pollTimers, webview);
    }
  }, SESSION_DISCOVERY_INTERVAL_MS);
  sessionDiscoveryTimerRef.current = discoveryTimer;
}

export function removeAgent(
  agentId: number,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  pollTimers: Map<number, ReturnType<typeof setInterval>>,
  persistAgents: () => void,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  stopDbPolling(agentId, pollTimers);
  cancelWaitingTimer(agentId, waitingTimers);
  cancelPermissionTimer(agentId, permissionTimers);

  agents.delete(agentId);
  persistAgents();
}

export function persistAgents(
  agents: Map<number, AgentState>,
  context: vscode.ExtensionContext,
): void {
  const persisted: PersistedAgent[] = [];
  for (const agent of agents.values()) {
    persisted.push({
      id: agent.id,
      terminalName: agent.terminalRef.name,
      sessionId: agent.sessionId,
      folderName: agent.folderName,
    });
  }
  context.workspaceState.update(WORKSPACE_KEY_AGENTS, persisted);
}

export async function restoreAgents(
  context: vscode.ExtensionContext,
  nextAgentIdRef: { current: number },
  nextTerminalIndexRef: { current: number },
  agents: Map<number, AgentState>,
  activeAgentIdRef: { current: number | null },
  webview: vscode.Webview | undefined,
  doPersist: () => void,
): Promise<void> {
  const persisted = context.workspaceState.get<PersistedAgent[]>(WORKSPACE_KEY_AGENTS, []);
  if (persisted.length === 0) return;

  await initDbPoller();

  const liveTerminals = vscode.window.terminals;
  let maxId = 0;
  let maxIdx = 0;

  for (const p of persisted) {
    const terminal = liveTerminals.find((t) => t.name === p.terminalName);
    if (!terminal) continue;

    const agent: AgentState = {
      id: p.id,
      terminalRef: terminal,
      sessionId: p.sessionId,
      lastPartTime: Date.now() - RESTORE_LOOKBACK_MS,
      lastSeenPartIds: new Set(),
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      folderName: p.folderName,
    };

    agents.set(p.id, agent);
    console.log(`[Pixel Agents] Restored agent ${p.id} → terminal "${p.terminalName}"`);

    if (p.id > maxId) maxId = p.id;
    const match = p.terminalName.match(/#(\d+)$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      if (idx > maxIdx) maxIdx = idx;
    }

    if (p.sessionId) {
      agent.sessionId = p.sessionId;
    }
  }

  if (maxId >= nextAgentIdRef.current) {
    nextAgentIdRef.current = maxId + 1;
  }
  if (maxIdx >= nextTerminalIndexRef.current) {
    nextTerminalIndexRef.current = maxIdx + 1;
  }

  doPersist();
}

export function startPollingForRestoredAgents(
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  pollTimers: Map<number, ReturnType<typeof setInterval>>,
  sessionDiscoveryTimerRef: { current: ReturnType<typeof setInterval> | null },
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
): void {
  const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  console.log(
    `[Pixel Agents] startPollingForRestoredAgents: ${agents.size} agents, workspaceDir="${workspaceDir}"`,
  );

  for (const [id, agent] of agents) {
    if (pollTimers.has(id)) continue;

    const bestSession = discoverMostRecentSession(workspaceDir);
    console.log(
      `[Pixel Agents] Agent ${id}: persisted="${agent.sessionId}", best=${bestSession ? bestSession.id : 'null'}`,
    );

    if (agent.sessionId && bestSession && bestSession.id !== agent.sessionId) {
      console.log(
        `[Pixel Agents] Agent ${id}: replacing stale session "${agent.sessionId}" → "${bestSession.id}"`,
      );
      agent.sessionId = bestSession.id;
      agent.lastPartTime = Date.now() - RESTORE_LOOKBACK_MS;
      agent.lastSeenPartIds.clear();
      persistAgents();
    }

    if (!agent.sessionId && bestSession) {
      agent.sessionId = bestSession.id;
      agent.lastPartTime = Date.now() - RESTORE_LOOKBACK_MS;
      agent.lastSeenPartIds.clear();
      console.log(`[Pixel Agents] Agent ${id}: discovered session ${bestSession.id}`);
      persistAgents();
    }

    if (agent.sessionId) {
      console.log(
        `[Pixel Agents] Agent ${id}: starting DB polling for session "${agent.sessionId}"`,
      );
      startDbPolling(id, agents, waitingTimers, permissionTimers, pollTimers, webview);
      continue;
    }

    console.log(`[Pixel Agents] Agent ${id}: no session found, starting discovery timer`);
    const discoveryTimer = setInterval(() => {
      if (!agents.has(id)) {
        clearInterval(discoveryTimer);
        return;
      }
      if (agent.sessionId) return;

      const found = discoverMostRecentSession(workspaceDir);
      if (found) {
        agent.sessionId = found.id;
        agent.lastPartTime = Date.now() - RESTORE_LOOKBACK_MS;
        agent.lastSeenPartIds.clear();
        console.log(`[Pixel Agents] Agent ${id}: discovered session ${found.id}`);
        persistAgents();
        startDbPolling(id, agents, waitingTimers, permissionTimers, pollTimers, webview);
      }
    }, SESSION_DISCOVERY_INTERVAL_MS);
    sessionDiscoveryTimerRef.current = discoveryTimer;
  }
}

export function sendExistingAgents(
  agents: Map<number, AgentState>,
  context: vscode.ExtensionContext,
  webview: vscode.Webview | undefined,
): void {
  if (!webview) return;
  const agentIds: number[] = [];
  for (const id of agents.keys()) {
    agentIds.push(id);
  }
  agentIds.sort((a, b) => a - b);

  const agentMeta = context.workspaceState.get<
    Record<string, { palette?: number; seatId?: string }>
  >(WORKSPACE_KEY_AGENT_SEATS, {});

  const folderNames: Record<number, string> = {};
  for (const [id, agent] of agents) {
    if (agent.folderName) {
      folderNames[id] = agent.folderName;
    }
  }
  console.log(
    `[Pixel Agents] sendExistingAgents: agents=${JSON.stringify(agentIds)}, meta=${JSON.stringify(agentMeta)}`,
  );

  webview.postMessage({
    type: 'existingAgents',
    agents: agentIds,
    agentMeta,
    folderNames,
  });

  sendCurrentAgentStatuses(agents, webview);
}

export function sendCurrentAgentStatuses(
  agents: Map<number, AgentState>,
  webview: vscode.Webview | undefined,
): void {
  if (!webview) return;
  for (const [agentId, agent] of agents) {
    for (const [toolId, status] of agent.activeToolStatuses) {
      webview.postMessage({
        type: 'agentToolStart',
        id: agentId,
        toolId,
        status,
      });
    }
    if (agent.isWaiting) {
      webview.postMessage({
        type: 'agentStatus',
        id: agentId,
        status: 'waiting',
      });
    }
  }
}

export function sendLayout(
  context: vscode.ExtensionContext,
  webview: vscode.Webview | undefined,
  defaultLayout?: Record<string, unknown> | null,
): void {
  if (!webview) return;
  const layout = migrateAndLoadLayout(context, defaultLayout);
  webview.postMessage({
    type: 'layoutLoaded',
    layout,
  });
}
