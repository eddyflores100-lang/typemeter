/** Leaderboard webview — ranked slowest declarations, click to jump. */
import * as vscode from 'vscode';
import { DeclResult, RunSummary } from '../engine/metrics';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

export function openLeaderboard(state: { summary: RunSummary | null }): void {
  const summary = state.summary;
  if (!summary) {
    vscode.window.showWarningMessage('TypeMeter: run "Measure Project Types" first.');
    return;
  }
  const topN = vscode.workspace.getConfiguration('typemeter').get<number>('topN', 50);
  const rows = summary.results.slice(0, topN);
  const panel = vscode.window.createWebviewPanel(
    'typemeter.leaderboard',
    'TypeMeter — Slowest Types',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  const body = rows
    .map(
      (r: DeclResult, i: number) => `
      <tr data-file="${esc(r.file)}" data-line="${r.line}">
        <td class="rank">${i + 1}</td>
        <td class="ms">${r.firstTouchMs >= 100 ? r.firstTouchMs.toFixed(0) : r.firstTouchMs.toFixed(2)}</td>
        <td>${r.instantiations}</td>
        <td>${r.typesCreated}</td>
        <td>${esc(r.complexity.grade)}</td>
        <td class="name">${esc(r.name)}</td>
        <td class="loc">${esc(relPath(r))}:${r.line + 1}</td>
      </tr>`
    )
    .join('');

  panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  h1 { font-size: 15px; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  th { color: var(--vscode-descriptionForeground); font-weight: 500; }
  tr:hover { background: var(--vscode-list-hoverBackground); cursor: pointer; }
  td.ms { font-variant-numeric: tabular-nums; text-align: right; }
  td.rank, td.ms { text-align: right; }
  td.name { font-family: var(--vscode-editor-font-family); }
  td.loc { color: var(--vscode-descriptionForeground); }
</style></head>
<body>
  <h1>TypeMeter — ${summary.declCount} declarations · total first-touch ${summary.totalMs.toFixed(1)} ms</h1>
  <div class="meta">TypeScript ${esc(summary.typescriptVersion)} (${esc(summary.typescriptSource)}) · program ${summary.programMs.toFixed(1)} ms · ${summary.fileCount} files</div>
  <table>
    <thead><tr><th>#</th><th>ms</th><th>inst</th><th>types</th><th>grade</th><th>declaration</th><th>location</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
<script>
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('tr[data-file]').forEach((tr) => {
    tr.addEventListener('click', () => {
      vscode.postMessage({ file: tr.dataset.file, line: parseInt(tr.dataset.line, 10) });
    });
  });
</script>
</body></html>`;

  panel.webview.onDidReceiveMessage(async (m: { file: string; line: number }) => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(m.file));
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    const pos = new vscode.Position(Math.max(0, m.line), 0);
    editor.revealRange(new vscode.Range(pos, pos.translate(3)));
    editor.selection = new vscode.Selection(pos, pos);
  });
}

function relPath(r: DeclResult): string {
  const parts = r.file.split(/[\\/]/);
  return parts.slice(-2).join('/');
}
