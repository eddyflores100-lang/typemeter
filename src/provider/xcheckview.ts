/** Cross-check webview — TypeMeter's numbers vs the compiler's own instrumentation. */
import * as vscode from 'vscode';
import { RunSummary } from '../engine/metrics';
import { CrossCheckReport } from '../engine/xcheck';

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

export function openCrossCheckView(
  getSummary: { summary: RunSummary | null },
  getReport: { report: CrossCheckReport | null }
): void {
  const report = getReport.report;
  const summary = getSummary.summary;
  if (!report || !summary) {
    vscode.window.showWarningMessage('TypeMeter: run the cross-check first.');
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'typemeter.crosscheck',
    'TypeMeter — Cross-check vs tsc',
    vscode.ViewColumn.One,
    {}
  );

  const cov = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
  const num = (v: number | null) => (v === null ? 'n/a' : v.toLocaleString());
  const ms = (v: number | null) => (v === null ? 'n/a' : `${v.toFixed(1)} ms`);

  const histRows = report.perFile.histogram
    .map(
      (h) => `<tr>
        <td class="num">${h.tscMs.toFixed(1)}</td>
        <td class="num">${h.sweepMs.toFixed(1)}</td>
        <td class="num">${h.decls}</td>
        <td class="loc">${esc(h.file)}</td>
      </tr>`
    )
    .join('');

  const notes = report.notes.length
    ? `<ul class="notes">${report.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '';

  panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  h1 { font-size: 15px; }
  h2 { font-size: 13px; margin-top: 16px; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  th { color: var(--vscode-descriptionForeground); font-weight: 500; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.loc { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); }
  .big { font-size: 14px; }
  .oom { color: var(--vscode-errorForeground); }
  .caveat, .notes { color: var(--vscode-descriptionForeground); font-size: 11px; }
</style></head>
<body>
  <h1>TypeMeter — cross-check vs tsc</h1>
  <div class="meta">tsc ${esc(report.tsc.version ?? '(n/a)')} · --noEmit --extendedDiagnostics --generateTrace ·
    exit ${esc(String(report.tsc.exitCode ?? 'null'))}${report.tsc.oom ? ' · <span class="oom">OOM KILLED — partial trace parsed, reported honestly</span>' : ''}</div>

  <h2>Counter identity (the anchors)</h2>
  <table>
    <thead><tr><th></th><th class="num">instantiations</th><th class="num">types</th></tr></thead>
    <tbody>
      <tr><td>TypeMeter sweep</td><td class="num">${report.counters.sweepInstantiations.toLocaleString()}</td><td class="num">${report.counters.sweepTypes.toLocaleString()}</td></tr>
      <tr><td>full tsc run</td><td class="num">${num(report.counters.tscInstantiations)}</td><td class="num">${num(report.counters.tscTypes)}</td></tr>
      <tr><td>coverage</td><td class="num">${cov(report.counters.instantiationCoverage)}</td><td class="num">${cov(report.counters.typeCoverage)}</td></tr>
    </tbody>
  </table>

  <h2>Cold-start totals</h2>
  <table>
    <tbody>
      <tr><td>tsc checkSourceFile total (project files)</td><td class="num">${ms(report.coldStart.tscCheckMs)}</td></tr>
      <tr><td>TypeMeter first-touch total</td><td class="num">${ms(report.coldStart.sweepFirstTouchMs)}</td></tr>
      <tr><td>program construction</td><td class="num">${ms(report.coldStart.programMs)}</td></tr>
    </tbody>
  </table>

  <h2>Per-file histogram (top ${report.perFile.histogram.length})${report.perFile.pearson !== null ? ` · Pearson r = ${report.perFile.pearson}` : ''}</h2>
  <table>
    <thead><tr><th class="num">tsc ms</th><th class="num">sweep ms</th><th class="num">decls</th><th>file</th></tr></thead>
    <tbody>${histRows}</tbody>
  </table>
  <p class="caveat">${esc(report.perFile.caveat)}</p>
  ${notes}
</body></html>`;
}
