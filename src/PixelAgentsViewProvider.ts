import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  launchNewTerminal,
  persistAgents,
  removeAgent,
  restoreAgents,
  sendExistingAgents,
  sendLayout,
  startPollingForRestoredAgents,
} from './agentManager.js';
import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
  sendAssetsToWebview,
  sendCharacterSpritesToWebview,
  sendFloorTilesToWebview,
  sendWallTilesToWebview,
} from './assetLoader.js';
import {
  GLOBAL_KEY_SOUND_ENABLED,
  OPENCODE_DATA_DIR,
  WORKSPACE_KEY_AGENT_SEATS,
} from './constants.js';
import { closeDbCache } from './dbPoller.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import { readLayoutFromFile, watchLayoutFile, writeLayoutToFile } from './layoutPersistence.js';
import type { AgentState } from './types.js';

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
  nextAgentId = { current: 1 };
  nextTerminalIndex = { current: 1 };
  agents = new Map<number, AgentState>();
  webviewView: vscode.WebviewView | undefined;

  waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  pollTimers = new Map<number, ReturnType<typeof setInterval>>();

  activeAgentId = { current: null as number | null };
  sessionDiscoveryTimer = { current: null as ReturnType<typeof setInterval> | null };

  defaultLayout: Record<string, unknown> | null = null;
  layoutWatcher: LayoutWatcher | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  private get webview(): vscode.Webview | undefined {
    return this.webviewView?.webview;
  }

  private persistAgents = (): void => {
    persistAgents(this.agents, this.context);
  };

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'openAgent') {
        await launchNewTerminal(
          this.nextAgentId,
          this.nextTerminalIndex,
          this.agents,
          this.activeAgentId,
          this.waitingTimers,
          this.permissionTimers,
          this.pollTimers,
          this.sessionDiscoveryTimer,
          this.webview,
          this.persistAgents,
          message.folderPath as string | undefined,
        );
      } else if (message.type === 'focusAgent') {
        const agent = this.agents.get(message.id);
        if (agent) {
          agent.terminalRef.show();
        }
      } else if (message.type === 'closeAgent') {
        const agent = this.agents.get(message.id);
        if (agent) {
          agent.terminalRef.dispose();
        }
      } else if (message.type === 'saveAgentSeats') {
        console.log(`[Pixel Agents] saveAgentSeats:`, JSON.stringify(message.seats));
        this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
      } else if (message.type === 'saveLayout') {
        this.layoutWatcher?.markOwnWrite();
        writeLayoutToFile(message.layout as Record<string, unknown>);
      } else if (message.type === 'setSoundEnabled') {
        this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
      } else if (message.type === 'webviewReady') {
        await restoreAgents(
          this.context,
          this.nextAgentId,
          this.nextTerminalIndex,
          this.agents,
          this.activeAgentId,
          this.webview,
          this.persistAgents,
        );

        const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
        this.webview?.postMessage({ type: 'settingsLoaded', soundEnabled });

        const wsFolders = vscode.workspace.workspaceFolders;
        if (wsFolders && wsFolders.length > 1) {
          this.webview?.postMessage({
            type: 'workspaceFolders',
            folders: wsFolders.map((f) => ({ name: f.name, path: f.uri.fsPath })),
          });
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        (async () => {
          try {
            const extensionPath = this.extensionUri.fsPath;
            const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
            let assetsRoot: string | null = null;
            if (fs.existsSync(bundledAssetsDir)) {
              assetsRoot = path.join(extensionPath, 'dist');
            } else if (workspaceRoot) {
              assetsRoot = workspaceRoot;
            }

            if (!assetsRoot) {
              if (this.webview) {
                sendLayout(this.context, this.webview, this.defaultLayout);
                this.startLayoutWatcher();
              }
              return;
            }

            this.defaultLayout = loadDefaultLayout(assetsRoot);

            const charSprites = await loadCharacterSprites(assetsRoot);
            if (charSprites && this.webview) {
              sendCharacterSpritesToWebview(this.webview, charSprites);
            }

            const floorTiles = await loadFloorTiles(assetsRoot);
            if (floorTiles && this.webview) {
              sendFloorTilesToWebview(this.webview, floorTiles);
            }

            const wallTiles = await loadWallTiles(assetsRoot);
            if (wallTiles && this.webview) {
              sendWallTilesToWebview(this.webview, wallTiles);
            }

            const assets = await loadFurnitureAssets(assetsRoot);
            if (assets && this.webview) {
              sendAssetsToWebview(this.webview, assets);
            }
          } catch (err) {
            console.error('[Extension] Error loading assets:', err);
          }
          if (this.webview) {
            sendLayout(this.context, this.webview, this.defaultLayout);
            this.startLayoutWatcher();
          }
        })();

        sendExistingAgents(this.agents, this.context, this.webview);

        startPollingForRestoredAgents(
          this.agents,
          this.waitingTimers,
          this.permissionTimers,
          this.pollTimers,
          this.sessionDiscoveryTimer,
          this.webview,
          this.persistAgents,
        );
      } else if (message.type === 'openSessionsFolder') {
        const folderUri = vscode.Uri.file(OPENCODE_DATA_DIR);
        await vscode.commands.executeCommand('revealFileInOS', folderUri);
      } else if (message.type === 'exportLayout') {
        const layout = readLayoutFromFile();
        if (!layout) {
          vscode.window.showWarningMessage('Pixel Agents: No saved layout to export.');
          return;
        }
        const uri = await vscode.window.showSaveDialog({
          filters: { 'JSON Files': ['json'] },
          defaultUri: vscode.Uri.file(path.join(os.homedir(), 'pixel-agents-layout.json')),
        });
        if (uri) {
          fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
          vscode.window.showInformationMessage('Pixel Agents: Layout exported successfully.');
        }
      } else if (message.type === 'importLayout') {
        const uris = await vscode.window.showOpenDialog({
          filters: { 'JSON Files': ['json'] },
          canSelectMany: false,
        });
        if (!uris || uris.length === 0) return;
        try {
          const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
          const imported = JSON.parse(raw) as Record<string, unknown>;
          if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
            vscode.window.showErrorMessage('Pixel Agents: Invalid layout file.');
            return;
          }
          this.layoutWatcher?.markOwnWrite();
          writeLayoutToFile(imported);
          this.webview?.postMessage({ type: 'layoutLoaded', layout: imported });
          vscode.window.showInformationMessage('Pixel Agents: Layout imported successfully.');
        } catch {
          vscode.window.showErrorMessage('Pixel Agents: Failed to read or parse layout file.');
        }
      }
    });

    vscode.window.onDidChangeActiveTerminal((terminal) => {
      this.activeAgentId.current = null;
      if (!terminal) return;
      for (const [id, agent] of this.agents) {
        if (agent.terminalRef === terminal) {
          this.activeAgentId.current = id;
          webviewView.webview.postMessage({ type: 'agentSelected', id });
          break;
        }
      }
    });

    vscode.window.onDidCloseTerminal((closed) => {
      for (const [id, agent] of this.agents) {
        if (agent.terminalRef === closed) {
          if (this.activeAgentId.current === id) {
            this.activeAgentId.current = null;
          }
          removeAgent(
            id,
            this.agents,
            this.waitingTimers,
            this.permissionTimers,
            this.pollTimers,
            this.persistAgents,
          );
          webviewView.webview.postMessage({ type: 'agentClosed', id });
        }
      }
    });
  }

  exportDefaultLayout(): void {
    const layout = readLayoutFromFile();
    if (!layout) {
      vscode.window.showWarningMessage('Pixel Agents: No saved layout found.');
      return;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('Pixel Agents: No workspace folder found.');
      return;
    }
    const targetPath = path.join(
      workspaceRoot,
      'webview-ui',
      'public',
      'assets',
      'default-layout.json',
    );
    const json = JSON.stringify(layout, null, 2);
    fs.writeFileSync(targetPath, json, 'utf-8');
    vscode.window.showInformationMessage(`Pixel Agents: Default layout exported to ${targetPath}`);
  }

  private startLayoutWatcher(): void {
    if (this.layoutWatcher) return;
    this.layoutWatcher = watchLayoutFile((layout) => {
      console.log('[Pixel Agents] External layout change — pushing to webview');
      this.webview?.postMessage({ type: 'layoutLoaded', layout });
    });
  }

  dispose() {
    this.layoutWatcher?.dispose();
    this.layoutWatcher = null;
    for (const id of [...this.agents.keys()]) {
      removeAgent(
        id,
        this.agents,
        this.waitingTimers,
        this.permissionTimers,
        this.pollTimers,
        this.persistAgents,
      );
    }
    if (this.sessionDiscoveryTimer.current) {
      clearInterval(this.sessionDiscoveryTimer.current);
      this.sessionDiscoveryTimer.current = null;
    }
    closeDbCache();
  }
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

  let html: string;
  try {
    html = fs.readFileSync(indexPath, 'utf-8');
  } catch {
    console.error(`[PixelAgents] Webview build missing: ${indexPath}`);
    return `<!DOCTYPE html><html><body><p>Webview assets not found. Run <code>npm run build</code> first.</p></body></html>`;
  }

  html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
    const fileUri = vscode.Uri.joinPath(distPath, filePath);
    const webviewUri = webview.asWebviewUri(fileUri);
    return `${attr}="${webviewUri}"`;
  });

  return html;
}
