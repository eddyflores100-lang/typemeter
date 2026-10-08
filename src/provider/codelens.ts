/** CodeLens provider — per-declaration cost line. */
import * as vscode from 'vscode';
import { MeasurementState } from '../state';

export class TypeMeterCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _emitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._emitter.event;

  constructor(private readonly state: MeasurementState) {
    state.onDidChange(() => this._emitter.fire());
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const enabled = vscode.workspace
      .getConfiguration('typemeter')
      .get<boolean>('codeLens', true);
    if (!enabled) return [];
    const rows = this.state.allForFile(document.uri.fsPath);
    const lenses: vscode.CodeLens[] = [];
    for (const r of rows) {
      const ms = r.firstTouchMs >= 100 ? r.firstTouchMs.toFixed(0) : r.firstTouchMs.toFixed(2);
      lenses.push(
        new vscode.CodeLens(
          new vscode.Range(r.line, 0, r.line, 0),
          {
            title: `⚡ ${ms} ms · ${r.instantiations} inst · ${r.complexity.grade}`,
            command: 'typemeter.showDetail',
            arguments: [document.uri.toString(), r.line],
          }
        )
      );
    }
    return lenses;
  }

  resolveCodeLens(lens: vscode.CodeLens): vscode.CodeLens {
    return lens;
  }
}
