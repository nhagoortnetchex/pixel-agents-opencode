/** Map status prefixes back to tool names for animation selection */
export const STATUS_TO_TOOL: Record<string, string> = {
  Reading: 'read',
  Searching: 'grep',
  Globbing: 'glob',
  Fetching: 'webfetch',
  'Searching web': 'websearch_web_search_exa',
  'Searching GitHub': 'grep_app_searchGitHub',
  'Searching code patterns': 'ast_grep_search',
  Writing: 'write',
  Editing: 'edit',
  Running: 'bash',
  Subtask: 'task',
  'Running subtask': 'task',
  'Updating todos': 'todowrite',
  'Reading background': 'background_output',
  'Analyzing code': 'lsp_diagnostics',
  'Analyzing media': 'look_at',
};

export function extractToolName(status: string): string | null {
  for (const [prefix, tool] of Object.entries(STATUS_TO_TOOL)) {
    if (status.startsWith(prefix)) return tool;
  }
  const first = status.split(/[\s:]/)[0];
  return first || null;
}

import { ZOOM_DEFAULT_DPR_FACTOR, ZOOM_MIN } from '../constants.js';

export function defaultZoom(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.max(ZOOM_MIN, Math.round(ZOOM_DEFAULT_DPR_FACTOR * dpr));
}
