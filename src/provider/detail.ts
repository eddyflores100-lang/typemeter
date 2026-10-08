/** Declaration detail webview — full metrics + cost attribution. */
import * as vscode from 'vscode';
import { DeclResult } from '../engine/metrics';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

export function openDetail(result: DeclResult): void {
  const panel = vscode.window.createWebviewPanel(
    'typemeter.detail',
    `TypeMeter — ${result.name}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

  const attrRows = result.attribution
    .map(
      (a) => `<tr><td>${esc(a.name)}</td><td>${a.ms !== null ? a.ms.toFixed(2) : '—'}</td><td>${a.instantiations ?? '—'}</td></tr>`
    )
    .join('');

  const c = result.complexity;
  const ms = result.firstTouchMs >= 100 ? result.firstTouchMs.toFixed(0) : result.firstTouchMs.toFixed(2);

  panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 14px; font-size: 13px; }
  h1 { font-size: 15px; margin: 0 0 2px; }
  .kind { color: var(--vscode-descriptionForeground); }
  .grid { display: grid; grid-template-columns: 130px 1fr; gap: 6px 14px; margin: 14px 0; }
  .grid div:nth-child(odd) { color: var(--vscode-descriptionForeground); }
  .big { font-size: 26px; font-weight: 600; margin: 10px 0 4px; }
  .big small { font-size: 12px; color: var(--vscode-descriptionForeground); font-weight: 400; }
  table { border-collapse: collapse; font-size: 12px; margin-top: 6px; }
  th, td { padding: 4px 10px 4px 0; text-align: left; border-bottom: 1px solid var(--vscode-panel-border); }
  th { color: var(--vscode-descriptionForeground); font-weight: 500; }
  h2 { font-size: 13px; margin: 18px 0 0; }
  button { margin-top: 14px; padding: 6px 12px; }
</style></head>
<body>
  <h1>${esc(result.name)}</h1>
  <div class="kind">${esc(result.kind)} · ${esc(relPath(result))}:${result.line + 1}</div>

  <div class="big">${ms} ms <small>first touch (fresh checker)</small></div>

  <div class="grid">
    <div>checker instantiations</div><div>${result.instantiations}</div>
    <div>types created</div><div>${result.typesCreated}</div>
    <div>complexity grade</div><div>${esc(c.grade)}</div>
    <div>properties (bounded)</div><div>${c.properties}</div>
    <div>union members</div><div>${c.unionMembers}</div>
    <div>intersection members</div><div>${c.intersectionMembers}</div>
    <div>structural depth</div><div>${c.depth}</div>
    <div>type string length</div><div>${c.typeStringLength}</div>
    <div>stringify time</div><div>${c.stringifyMs.toFixed(3)} ms</div>
  </div>

  <h2>Cost attribution — what this declaration pulls in</h2>
  ${attrRows
    ? `<table><thead><tr><th>referenced declaration</th><th>its first-touch ms</th><th>its instantiations</th></tr></thead><tbody>${attrRows}</tbody></table>`
    : '<div class="kind">No measured in-project references.</div>'}

  <button id="jump">Jump to declaration</button>
  <button id="copy">Copy JSON</button>

<script>
  const vscode = acquireVsCodeApi();
  document.getElementById('jump').addEventListener('click', () => {
    vscode.postMessage({ cmd: 'jump' });
  });
  document.getElementById('copy').addEventListener('click', () => {
    vscode.postMessage({ cmd: 'copy' });
  });
</script>
</body></html>`;

  panel.webview.onDidReceiveMessage(async (m: { cmd: string }) => {
    if (m.cmd === 'jump') {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(result.file));
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      const pos = new vscode.Position(Math.max(0, result.line), 0);
      editor.revealRange(new vscode.Range(pos, pos.translate(3)));
      editor.selection = new vscode.Selection(pos, pos);
    } else if (m.cmd === 'copy') {
      vscode.env.clipboard.writeText(JSON.stringify(result, null, 2));
      vscode.window.setStatusBarMessage('TypeMeter: result copied as JSON', 2500);
    }
  });
}

function relPath(r: DeclResult): string {
  const parts = r.file.split(/[\\/]/);
  return parts.slice(-2).join('/');
}
