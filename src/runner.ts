/** Spawn the measurement worker and stream progress. */
import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { RunSummary, WorkerLine } from './engine/metrics';

export interface RunOptions {
  projectDir: string;
  tsconfig?: string;
  onProgress?: (done: number, total: number, file: string) => void;
  token?: vscode.CancellationToken;
}

export function workerPath(extensionPath: string): string {
  return path.join(extensionPath, 'dist', 'engine', 'worker.js');
}

export function runMeasurement(
  extensionPath: string,
  opts: RunOptions
): Promise<RunSummary> {
  return new Promise((resolve, reject) => {
    const args = [workerPath(extensionPath), '--project', opts.projectDir];
    if (opts.tsconfig) args.push('--tsconfig', opts.tsconfig);
    const cp = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const cancelSub = opts.token?.onCancellationRequested(() => {
      try {
        cp.kill();
      } catch {
        /* already gone */
      }
      reject(new Error('cancelled'));
    });

    let buf = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cancelSub?.dispose();
      fn();
    };

    cp.stdout.setEncoding('utf8');
    cp.stdout.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let parsed: WorkerLine;
        try {
          parsed = JSON.parse(line) as WorkerLine;
        } catch {
          continue;
        }
        if (parsed.type === 'progress') {
          opts.onProgress?.(parsed.done, parsed.total, parsed.file);
        } else if (parsed.type === 'summary') {
          const s = parsed.summary;
          finish(() => resolve(s));
          try {
            cp.kill();
          } catch {
            /* summary already received */
          }
        } else if (parsed.type === 'error') {
          finish(() => reject(new Error(parsed.message)));
        }
      }
    });
    cp.stderr.setEncoding('utf8');
    cp.stderr.on('data', (c: string) => (stderr += c));
    cp.on('error', (e) => finish(() => reject(e)));
    cp.on('close', () => {
      if (stderr) {
        finish(() => reject(new Error(`worker: ${stderr.slice(0, 600)}`)));
      }
    });
  });
}

/** Resolve which tsconfig to use; asks the user when several exist. */
export async function pickTsconfig(): Promise<
  { projectDir: string; tsconfig: string } | undefined
> {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) {
    vscode.window.showWarningMessage('TypeMeter: open a workspace folder first.');
    return undefined;
  }
  const uris = await vscode.workspace.findFiles(
    '**/tsconfig*.json',
    '**/{node_modules,dist,out,build}/**'
  );
  if (uris.length === 0) {
    vscode.window.showWarningMessage('TypeMeter: no tsconfig.json found in the workspace.');
    return undefined;
  }
  const rel = (u: vscode.Uri) => vscode.workspace.asRelativePath(u);
  let chosen: vscode.Uri;
  if (uris.length === 1) {
    chosen = uris[0];
  } else {
    const picks = uris.map((u) => ({ label: rel(u), detail: u.fsPath, uri: u }));
    const sel = await vscode.window.showQuickPick(picks, {
      placeHolder: 'Which tsconfig should TypeMeter measure?',
    });
    if (!sel) return undefined;
    chosen = sel.uri;
  }
  return { projectDir: ws.uri.fsPath, tsconfig: chosen.fsPath };
}
