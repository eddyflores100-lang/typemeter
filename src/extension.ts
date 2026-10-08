/** TypeMeter — VS Code extension entrypoint. */
import * as vscode from 'vscode';
import { MeasurementState } from './state';
import { pickTsconfig, runMeasurement } from './runner';
import { TypeMeterCodeLensProvider } from './provider/codelens';
import { TypeMeterHoverProvider } from './provider/hover';
import { openLeaderboard } from './provider/leaderboard';
import { openDetail } from './provider/detail';

let state: MeasurementState;
let statusItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  state = new MeasurementState();

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusItem.text = '$(graph) TypeMeter';
  statusItem.tooltip = 'Run TypeMeter to measure type load-time and complexity';
  statusItem.command = 'typemeter.measureProject';
  statusItem.show();

  const docSelector: vscode.DocumentSelector = [
    { scheme: 'file', language: 'typescript' },
    { scheme: 'file', language: 'typescriptreact' },
  ];

  context.subscriptions.push(
    statusItem,
    vscode.languages.registerCodeLensProvider(docSelector, new TypeMeterCodeLensProvider(state)),
    vscode.languages.registerHoverProvider(docSelector, new TypeMeterHoverProvider(state)),
    registerCommands(context),
    registerWatch()
  );
}

function registerCommands(context: vscode.ExtensionContext): vscode.Disposable {
  const measure = async (silent = false): Promise<boolean> => {
    const target = await pickTsconfig();
    if (!target) return false;
    try {
      const summary = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'TypeMeter: measuring declarations',
          cancellable: true,
        },
        (progress, token) => {
          let lastPct = -1;
          return runMeasurement(context.extensionPath, {
            ...target,
            token,
            onProgress: (done, total, file) => {
              const pct = Math.floor((done / Math.max(1, total)) * 100);
              if (pct !== lastPct) {
                lastPct = pct;
                progress.report({ message: `${done}/${total} (${file})`, increment: pct - (lastPct === 0 ? 0 : 0) });
              }
            },
          });
        }
      );
      state.set(summary);
      statusItem.text = `$(graph) ${summary.declCount} decls · ${summary.totalMs.toFixed(0)} ms`;
      statusItem.tooltip = `TypeMeter: ${summary.declCount} declarations · total first-touch ${summary.totalMs.toFixed(1)} ms · TS ${summary.typescriptVersion} (${summary.typescriptSource})`;
      if (!silent) {
        const open = await vscode.window.showInformationMessage(
          `TypeMeter: measured ${summary.declCount} declarations in ${summary.totalMs.toFixed(1)} ms.`,
          'Show slowest types'
        );
        if (open === 'Show slowest types') openLeaderboard({ get summary() { return state.summary; } });
      }
      return true;
    } catch (e) {
      if (!silent) {
        vscode.window.showErrorMessage(`TypeMeter: ${e instanceof Error ? e.message : String(e)}`);
      }
      return false;
    }
  };

  const showDetailFor = (fileStr: string, line: number) => {
    let fsPath = fileStr;
    try {
      fsPath = vscode.Uri.parse(fileStr).fsPath;
    } catch {
      /* plain path already */
    }
    const r = state.nearest(fsPath, line);
    if (!r) {
      vscode.window.showWarningMessage('TypeMeter: no measurement for this file — run "Measure Project Types".');
      return;
    }
    openDetail(r);
  };

  return vscode.Disposable.from(
    vscode.commands.registerCommand('typemeter.measureProject', () => measure(false)),
    vscode.commands.registerCommand('typemeter.measureAtCursor', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      if (!state.hasFile(editor.document.uri.fsPath)) {
        const ok = await measure(false);
        if (!ok) return;
      }
      const r = state.nearest(editor.document.uri.fsPath, editor.selection.active.line);
      if (!r) {
        vscode.window.showInformationMessage('TypeMeter: no declaration measured near the cursor.');
        return;
      }
      openDetail(r);
    }),
    vscode.commands.registerCommand('typemeter.showLeaderboard', () => openLeaderboard({ get summary() { return state.summary; } })),
    vscode.commands.registerCommand('typemeter.showDetail', (fileStr: string, line: number) => showDetailFor(fileStr, line))
  );
}

function registerWatch(): vscode.Disposable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.languageId !== 'typescript' && doc.languageId !== 'typescriptreact') return;
    const enabled = vscode.workspace.getConfiguration('typemeter').get<boolean>('watchOnSave', false);
    if (!enabled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void vscode.commands.executeCommand('typemeter.measureProject');
    }, 2000);
  });
}

export function deactivate(): void {
  /* nothing persistent */
}
