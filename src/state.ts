/** Shared measurement state for the extension. */
import * as vscode from 'vscode';
import { DeclResult, RunSummary } from './engine/metrics';

export class MeasurementState {
  private _summary: RunSummary | null = null;
  private _byFile = new Map<string, Map<number, DeclResult>>();
  private readonly _emitter = new vscode.EventEmitter<void>();
  public readonly onDidChange = this._emitter.event;

  public get summary(): RunSummary | null {
    return this._summary;
  }

  public set(summary: RunSummary): void {
    this._summary = summary;
    this._byFile = new Map();
    for (const r of summary.results) {
      let m = this._byFile.get(r.file);
      if (!m) {
        m = new Map();
        this._byFile.set(r.file, m);
      }
      m.set(r.line, r);
    }
    this._emitter.fire();
  }

  public clear(): void {
    this._summary = null;
    this._byFile = new Map();
    this._emitter.fire();
  }

  public hasFile(fsPath: string): boolean {
    return this._byFile.has(fsPath);
  }

  public resultAt(fsPath: string, line: number): DeclResult | undefined {
    return this._byFile.get(fsPath)?.get(line);
  }

  /** nearest measured declaration to a line in a file */
  public nearest(fsPath: string, line: number): DeclResult | undefined {
    const m = this._byFile.get(fsPath);
    if (!m) return undefined;
    let best: DeclResult | undefined;
    let bestDist = Number.MAX_SAFE_INTEGER;
    for (const r of m.values()) {
      const d = Math.abs(r.line - line);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    return best;
  }

  public allForFile(fsPath: string): DeclResult[] {
    const m = this._byFile.get(fsPath);
    if (!m) return [];
    return [...m.values()].sort((a, b) => a.line - b.line);
  }
}
