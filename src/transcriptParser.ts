import * as path from 'path';
import type * as vscode from 'vscode';

import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
  TEXT_IDLE_DELAY_MS,
  TOOL_DONE_DELAY_MS,
} from './constants.js';
import {
  cancelPermissionTimer,
  cancelWaitingTimer,
  clearAgentActivity,
  startPermissionTimer,
  startWaitingTimer,
} from './timerManager.js';
import type { AgentState } from './types.js';

export const PERMISSION_EXEMPT_TOOLS = new Set(['task', 'todowrite']);

export function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'read':
      return `Reading ${base(input.filePath)}`;
    case 'edit':
      return `Editing ${base(input.filePath)}`;
    case 'write':
      return `Writing ${base(input.filePath)}`;
    case 'bash': {
      const cmd = (input.command as string) || '';
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
    }
    case 'glob':
      return 'Searching files';
    case 'grep':
      return 'Searching code';
    case 'webfetch':
      return 'Fetching web content';
    case 'websearch_web_search_exa':
      return 'Searching the web';
    case 'task': {
      const desc = typeof input.description === 'string' ? input.description : '';
      return desc
        ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}`
        : 'Running subtask';
    }
    case 'todowrite':
      return 'Updating todos';
    case 'background_output':
      return 'Reading background task';
    case 'grep_app_searchGitHub':
      return 'Searching GitHub';
    case 'lsp_diagnostics':
    case 'lsp_goto_definition':
    case 'lsp_find_references':
    case 'lsp_symbols':
    case 'lsp_rename':
    case 'lsp_prepare_rename':
      return 'Analyzing code';
    case 'ast_grep_search':
    case 'ast_grep_replace':
      return 'Searching code patterns';
    case 'look_at':
      return 'Analyzing media';
    default:
      return `Using ${toolName}`;
  }
}

interface PartData {
  type: string;
  callID?: string;
  tool?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    output?: string;
    metadata?: Record<string, unknown>;
    time?: { start?: number; end?: number };
  };
  reason?: string;
  text?: string;
}

export function processPartRecord(
  agentId: number,
  partData: PartData,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  if (partData.type === 'tool') {
    processToolPart(agentId, partData, agent, agents, waitingTimers, permissionTimers, webview);
  } else if (partData.type === 'step-finish') {
    processStepFinish(agentId, partData, agent, waitingTimers, permissionTimers, webview);
  } else if (partData.type === 'text' && !agent.hadToolsInTurn) {
    startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
  } else if (partData.type === 'step-start') {
    cancelWaitingTimer(agentId, waitingTimers);
    clearAgentActivity(agent, agentId, permissionTimers, webview);
    agent.hadToolsInTurn = false;
  }
}

function processToolPart(
  agentId: number,
  partData: PartData,
  agent: AgentState,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  const callID = partData.callID;
  const toolName = partData.tool || '';
  const state = partData.state;
  if (!callID || !state) return;

  const status = state.status || '';

  if (status === 'pending' || status === 'running') {
    cancelWaitingTimer(agentId, waitingTimers);
    agent.isWaiting = false;
    agent.hadToolsInTurn = true;
    webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });

    if (!agent.activeToolIds.has(callID)) {
      const toolStatus = formatToolStatus(toolName, state.input || {});
      console.log(`[Pixel Agents] Agent ${agentId} tool start: ${callID} ${toolStatus}`);
      agent.activeToolIds.add(callID);
      agent.activeToolStatuses.set(callID, toolStatus);
      agent.activeToolNames.set(callID, toolName);

      webview?.postMessage({
        type: 'agentToolStart',
        id: agentId,
        toolId: callID,
        status: toolStatus,
      });

      if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
        startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
      }
    }
  } else if (status === 'completed' || status === 'error') {
    const wasTracked = agent.activeToolIds.has(callID);

    if (!wasTracked) {
      const toolStatus = formatToolStatus(toolName, state.input || {});
      console.log(`[Pixel Agents] Agent ${agentId} tool flash: ${callID} ${toolStatus}`);
      agent.hadToolsInTurn = true;
      webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
      webview?.postMessage({
        type: 'agentToolStart',
        id: agentId,
        toolId: callID,
        status: toolStatus,
      });
    } else {
      console.log(`[Pixel Agents] Agent ${agentId} tool done: ${callID}`);

      if (agent.activeToolNames.get(callID) === 'task') {
        agent.activeSubagentToolIds.delete(callID);
        agent.activeSubagentToolNames.delete(callID);
        webview?.postMessage({
          type: 'subagentClear',
          id: agentId,
          parentToolId: callID,
        });
      }

      agent.activeToolIds.delete(callID);
      agent.activeToolStatuses.delete(callID);
      agent.activeToolNames.delete(callID);
    }

    const toolId = callID;
    setTimeout(() => {
      webview?.postMessage({
        type: 'agentToolDone',
        id: agentId,
        toolId,
      });
    }, TOOL_DONE_DELAY_MS);

    if (agent.activeToolIds.size === 0) {
      agent.hadToolsInTurn = false;
    }
  }
}

function processStepFinish(
  agentId: number,
  partData: PartData,
  agent: AgentState,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  if (partData.reason !== 'stop') return;

  cancelWaitingTimer(agentId, waitingTimers);
  cancelPermissionTimer(agentId, permissionTimers);

  if (agent.activeToolIds.size > 0) {
    agent.activeToolIds.clear();
    agent.activeToolStatuses.clear();
    agent.activeToolNames.clear();
    agent.activeSubagentToolIds.clear();
    agent.activeSubagentToolNames.clear();
    webview?.postMessage({ type: 'agentToolsClear', id: agentId });
  }

  agent.isWaiting = true;
  agent.permissionSent = false;
  agent.hadToolsInTurn = false;
  webview?.postMessage({
    type: 'agentStatus',
    id: agentId,
    status: 'waiting',
  });
}
