import { execFileSync } from 'child_process';
import * as fs from 'fs';
import type initSqlJsFn from 'sql.js/dist/sql-asm.js';
import type * as vscode from 'vscode';

import { DB_POLL_INTERVAL_MS, OPENCODE_DB_PATH } from './constants.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './timerManager.js';
import { processPartRecord } from './transcriptParser.js';
import type { AgentState } from './types.js';

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJsFn>>;
type SqlJsDatabase = InstanceType<SqlJsStatic['Database']>;

let cachedSqlJs: SqlJsStatic | null = null;
let cachedDb: SqlJsDatabase | null = null;
let cachedDbMtimeMs = 0;

const OPENCODE_WAL_PATH = OPENCODE_DB_PATH + '-wal';

async function getSqlJs(): Promise<SqlJsStatic> {
  if (cachedSqlJs) return cachedSqlJs;
  const mod = await import('sql.js/dist/sql-asm.js');
  const init = (mod.default || mod) as typeof initSqlJsFn;
  cachedSqlJs = await init();
  return cachedSqlJs;
}

function checkpointWal(): void {
  try {
    execFileSync('sqlite3', [OPENCODE_DB_PATH, 'PRAGMA wal_checkpoint(PASSIVE);'], {
      timeout: 2000,
      stdio: 'ignore',
    });
  } catch {
    /* sqlite3 not available or checkpoint failed — proceed with stale data */
  }
}

function openDbReadonly(): SqlJsDatabase | null {
  if (!cachedSqlJs) return null;
  try {
    let walExists = false;
    try {
      fs.statSync(OPENCODE_WAL_PATH);
      walExists = true;
    } catch {
      /* no WAL file */
    }

    // When WAL file exists, OpenCode is actively writing to it.
    // sql.js reads from a file buffer and is blind to WAL data, so we must
    // checkpoint on EVERY poll to flush WAL → main DB, then re-read the file.
    // Only use the cached DB when no WAL file exists (agent is idle).
    if (walExists) {
      checkpointWal();
    }

    const dbStat = fs.statSync(OPENCODE_DB_PATH);
    if (cachedDb && !walExists && dbStat.mtimeMs === cachedDbMtimeMs) {
      return cachedDb;
    }

    if (cachedDb) {
      try {
        cachedDb.close();
      } catch {
        /* already closed */
      }
      cachedDb = null;
    }

    const buf = fs.readFileSync(OPENCODE_DB_PATH);
    cachedDb = new cachedSqlJs.Database(buf);
    cachedDbMtimeMs = dbStat.mtimeMs;
    return cachedDb;
  } catch (e) {
    console.log(`[Pixel Agents] Failed to open DB: ${e}`);
    return null;
  }
}

export async function initDbPoller(): Promise<boolean> {
  try {
    await getSqlJs();
    const exists = fs.existsSync(OPENCODE_DB_PATH);
    console.log(
      `[Pixel Agents] initDbPoller: sql.js=${!!cachedSqlJs}, dbExists=${exists}, path=${OPENCODE_DB_PATH}`,
    );
    return exists;
  } catch (e) {
    console.log(`[Pixel Agents] Failed to init sql.js: ${e}`);
    return false;
  }
}

export function pollAgentParts(
  agentId: number,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  const agent = agents.get(agentId);
  if (!agent || !agent.sessionId) return;

  const db = openDbReadonly();
  if (!db) return;

  try {
    const results = db.exec(
      `SELECT id, data, time_updated FROM part
       WHERE session_id = ?
         AND time_updated >= ?
       ORDER BY time_updated ASC`,
      [agent.sessionId, agent.lastPartTime],
    );

    if (results.length === 0 || results[0].values.length === 0) {
      console.log(
        `[Pixel Agents] Poll agent ${agentId}: no results (session=${agent.sessionId}, since=${agent.lastPartTime})`,
      );
      return;
    }
    console.log(`[Pixel Agents] Poll agent ${agentId}: ${results[0].values.length} rows found`);

    const rows = results[0].values;
    let hasNewData = false;
    const newSeenIds = new Set<string>();

    for (const row of rows) {
      const partId = row[0] as string;
      const dataStr = row[1] as string;
      const timeUpdated = row[2] as number;

      if (agent.lastSeenPartIds.has(partId)) continue;

      if (timeUpdated > agent.lastPartTime) {
        agent.lastPartTime = timeUpdated;
        agent.lastSeenPartIds.clear();
      }
      newSeenIds.add(partId);
      hasNewData = true;

      try {
        const partData = JSON.parse(dataStr);
        processPartRecord(agentId, partData, agents, waitingTimers, permissionTimers, webview);
      } catch {
        /* malformed JSON */
      }
    }

    for (const id of newSeenIds) {
      agent.lastSeenPartIds.add(id);
    }

    if (hasNewData) {
      cancelWaitingTimer(agentId, waitingTimers);
      cancelPermissionTimer(agentId, permissionTimers);
      if (agent.permissionSent) {
        agent.permissionSent = false;
        webview?.postMessage({ type: 'agentToolPermissionClear', id: agentId });
      }
    }
  } catch (e) {
    console.log(`[Pixel Agents] DB poll error for agent ${agentId}: ${e}`);
  }
}

export function discoverSessions(workspaceDir: string): Array<{ id: string; timeCreated: number }> {
  const db = openDbReadonly();
  if (!db) return [];

  try {
    // Use time_created (not time_updated) so we match the session that was
    // actually *created* after the terminal launched, not an older session
    // that merely received new messages.  Filter by directory when available
    // so multi-workspace setups don't cross-match.
    const hasDir = workspaceDir.length > 0;
    const sql = hasDir
      ? `SELECT s.id, s.time_created FROM session s
         WHERE s.directory = ?
         ORDER BY s.time_created DESC
         LIMIT 20`
      : `SELECT s.id, s.time_created FROM session s
         ORDER BY s.time_created DESC
         LIMIT 20`;
    const results = db.exec(sql, hasDir ? [workspaceDir] : []);

    if (results.length === 0) return [];

    return results[0].values.map((row) => ({
      id: row[0] as string,
      timeCreated: row[1] as number,
    }));
  } catch (e) {
    console.log(`[Pixel Agents] Session discovery error: ${e}`);
    return [];
  }
}

/**
 * Find the most recently *active* session for a workspace directory.
 * Orders by time_updated (not time_created) so we get the session that
 * has the latest activity — critical for restored agents whose persisted
 * sessionId may point to a dead session.
 */
export function discoverMostRecentSession(
  workspaceDir: string,
): { id: string; timeUpdated: number } | null {
  const db = openDbReadonly();
  if (!db) return null;

  try {
    const hasDir = workspaceDir.length > 0;
    const sql = hasDir
      ? `SELECT s.id, s.time_updated FROM session s
         WHERE s.directory = ?
         ORDER BY s.time_updated DESC
         LIMIT 1`
      : `SELECT s.id, s.time_updated FROM session s
         ORDER BY s.time_updated DESC
         LIMIT 1`;
    const results = db.exec(sql, hasDir ? [workspaceDir] : []);

    if (results.length === 0 || results[0].values.length === 0) return null;

    const row = results[0].values[0];
    return { id: row[0] as string, timeUpdated: row[1] as number };
  } catch (e) {
    console.log(`[Pixel Agents] discoverMostRecentSession error: ${e}`);
    return null;
  }
}

export function startDbPolling(
  agentId: number,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  pollTimers: Map<number, ReturnType<typeof setInterval>>,
  webview: vscode.Webview | undefined,
): void {
  const timer = setInterval(() => {
    if (!agents.has(agentId)) {
      clearInterval(timer);
      pollTimers.delete(agentId);
      return;
    }
    pollAgentParts(agentId, agents, waitingTimers, permissionTimers, webview);
  }, DB_POLL_INTERVAL_MS);
  pollTimers.set(agentId, timer);

  pollAgentParts(agentId, agents, waitingTimers, permissionTimers, webview);
}

export function stopDbPolling(
  agentId: number,
  pollTimers: Map<number, ReturnType<typeof setInterval>>,
): void {
  const timer = pollTimers.get(agentId);
  if (timer) {
    clearInterval(timer);
    pollTimers.delete(agentId);
  }
}

export function closeDbCache(): void {
  if (cachedDb) {
    try {
      cachedDb.close();
    } catch {
      /* already closed */
    }
    cachedDb = null;
    cachedDbMtimeMs = 0;
  }
}
