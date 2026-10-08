"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode8 = __toESM(require("vscode"));

// src/state.ts
var vscode = __toESM(require("vscode"));
var MeasurementState = class {
  _summary = null;
  _byFile = /* @__PURE__ */ new Map();
  _emitter = new vscode.EventEmitter();
  onDidChange = this._emitter.event;
  get summary() {
    return this._summary;
  }
  set(summary) {
    this._summary = summary;
    this._byFile = /* @__PURE__ */ new Map();
    for (const r of summary.results) {
      let m = this._byFile.get(r.file);
      if (!m) {
        m = /* @__PURE__ */ new Map();
        this._byFile.set(r.file, m);
      }
      m.set(r.line, r);
    }
    this._emitter.fire();
  }
  clear() {
    this._summary = null;
    this._byFile = /* @__PURE__ */ new Map();
    this._emitter.fire();
  }
  hasFile(fsPath) {
    return this._byFile.has(fsPath);
  }
  resultAt(fsPath, line) {
    return this._byFile.get(fsPath)?.get(line);
  }
  /** nearest measured declaration to a line in a file */
  nearest(fsPath, line) {
    const m = this._byFile.get(fsPath);
    if (!m) return void 0;
    let best;
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
  allForFile(fsPath) {
    const m = this._byFile.get(fsPath);
    if (!m) return [];
    return [...m.values()].sort((a, b) => a.line - b.line);
  }
};

// src/runner.ts
var import_child_process = require("child_process");
var path = __toESM(require("path"));
var vscode2 = __toESM(require("vscode"));
function workerPath(extensionPath) {
  return path.join(extensionPath, "dist", "engine", "worker.js");
}
function runMeasurement(extensionPath, opts) {
  return new Promise((resolve2, reject) => {
    const args = [workerPath(extensionPath), "--project", opts.projectDir];
    if (opts.tsconfig) args.push("--tsconfig", opts.tsconfig);
    const cp = (0, import_child_process.spawn)(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const cancelSub = opts.token?.onCancellationRequested(() => {
      try {
        cp.kill();
      } catch {
      }
      reject(new Error("cancelled"));
    });
    let buf = "";
    let stderr = "";
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      cancelSub?.dispose();
      fn();
    };
    cp.stdout.setEncoding("utf8");
    cp.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed.type === "progress") {
          opts.onProgress?.(parsed.done, parsed.total, parsed.file);
        } else if (parsed.type === "summary") {
          const s = parsed.summary;
          finish(() => resolve2(s));
          try {
            cp.kill();
          } catch {
          }
        } else if (parsed.type === "error") {
          finish(() => reject(new Error(parsed.message)));
        }
      }
    });
    cp.stderr.setEncoding("utf8");
    cp.stderr.on("data", (c) => stderr += c);
    cp.on("error", (e) => finish(() => reject(e)));
    cp.on("close", () => {
      if (stderr) {
        finish(() => reject(new Error(`worker: ${stderr.slice(0, 600)}`)));
      }
    });
  });
}
async function pickTsconfig() {
  const ws = vscode2.workspace.workspaceFolders?.[0];
  if (!ws) {
    vscode2.window.showWarningMessage("TypeMeter: open a workspace folder first.");
    return void 0;
  }
  const uris = await vscode2.workspace.findFiles(
    "**/tsconfig*.json",
    "**/{node_modules,dist,out,build}/**"
  );
  if (uris.length === 0) {
    vscode2.window.showWarningMessage("TypeMeter: no tsconfig.json found in the workspace.");
    return void 0;
  }
  const rel = (u) => vscode2.workspace.asRelativePath(u);
  let chosen;
  if (uris.length === 1) {
    chosen = uris[0];
  } else {
    const picks = uris.map((u) => ({ label: rel(u), detail: u.fsPath, uri: u }));
    const sel = await vscode2.window.showQuickPick(picks, {
      placeHolder: "Which tsconfig should TypeMeter measure?"
    });
    if (!sel) return void 0;
    chosen = sel.uri;
  }
  return { projectDir: ws.uri.fsPath, tsconfig: chosen.fsPath };
}

// src/provider/codelens.ts
var vscode3 = __toESM(require("vscode"));
var TypeMeterCodeLensProvider = class {
  constructor(state2) {
    this.state = state2;
    state2.onDidChange(() => this._emitter.fire());
  }
  _emitter = new vscode3.EventEmitter();
  onDidChangeCodeLenses = this._emitter.event;
  provideCodeLenses(document, _token) {
    const enabled = vscode3.workspace.getConfiguration("typemeter").get("codeLens", true);
    if (!enabled) return [];
    const rows = this.state.allForFile(document.uri.fsPath);
    const lenses = [];
    for (const r of rows) {
      const ms = r.firstTouchMs >= 100 ? r.firstTouchMs.toFixed(0) : r.firstTouchMs.toFixed(2);
      lenses.push(
        new vscode3.CodeLens(
          new vscode3.Range(r.line, 0, r.line, 0),
          {
            title: `\u26A1 ${ms} ms \xB7 ${r.instantiations} inst \xB7 ${r.complexity.grade}`,
            command: "typemeter.showDetail",
            arguments: [document.uri.toString(), r.line]
          }
        )
      );
    }
    return lenses;
  }
  resolveCodeLens(lens) {
    return lens;
  }
};

// src/provider/hover.ts
var vscode4 = __toESM(require("vscode"));
var TypeMeterHoverProvider = class {
  constructor(state2) {
    this.state = state2;
  }
  provideHover(document, position, _token) {
    const r = this.state.resultAt(document.uri.fsPath, position.line);
    if (!r) return void 0;
    const md = new vscode4.MarkdownString("", true);
    md.isTrusted = true;
    const ms = r.firstTouchMs >= 100 ? r.firstTouchMs.toFixed(0) : r.firstTouchMs.toFixed(2);
    const attr = r.attribution.slice(0, 3).map((a) => `\`${a.name}\` (${a.ms !== null ? a.ms.toFixed(1) + " ms" : "unmeasured"})`).join(", ");
    md.appendMarkdown(
      `**TypeMeter** \u2014 \`${r.kind}\` \`${r.name}\`

- first touch: **${ms} ms**
- checker instantiations: **${r.instantiations}** \xB7 types created: **${r.typesCreated}**
- complexity: **${r.complexity.grade}** (${r.complexity.properties} props \xB7 union \u2264 ${r.complexity.unionMembers} \xB7 depth ${r.complexity.depth} \xB7 string len ${r.complexity.typeStringLength})
` + (attr ? `- cost attribution: ${attr}
` : "") + `
[Show detail](command:typemeter.showDetail?${encodeURIComponent(
        JSON.stringify([document.uri.toString(), r.line])
      )})`
    );
    return new vscode4.Hover(md, new vscode4.Range(position.line, 0, position.line, 0));
  }
};

// src/provider/leaderboard.ts
var vscode5 = __toESM(require("vscode"));
function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function openLeaderboard(state2) {
  const summary = state2.summary;
  if (!summary) {
    vscode5.window.showWarningMessage('TypeMeter: run "Measure Project Types" first.');
    return;
  }
  const topN = vscode5.workspace.getConfiguration("typemeter").get("topN", 50);
  const rows = summary.results.slice(0, topN);
  const panel = vscode5.window.createWebviewPanel(
    "typemeter.leaderboard",
    "TypeMeter \u2014 Slowest Types",
    vscode5.ViewColumn.One,
    { enableScripts: true }
  );
  const body = rows.map(
    (r, i) => `
      <tr data-file="${esc(r.file)}" data-line="${r.line}">
        <td class="rank">${i + 1}</td>
        <td class="ms">${r.firstTouchMs >= 100 ? r.firstTouchMs.toFixed(0) : r.firstTouchMs.toFixed(2)}</td>
        <td>${r.instantiations}</td>
        <td>${r.typesCreated}</td>
        <td>${esc(r.complexity.grade)}</td>
        <td class="name">${esc(r.name)}</td>
        <td class="loc">${esc(relPath(r))}:${r.line + 1}</td>
      </tr>`
  ).join("");
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
  <h1>TypeMeter \u2014 ${summary.declCount} declarations \xB7 total first-touch ${summary.totalMs.toFixed(1)} ms</h1>
  <div class="meta">TypeScript ${esc(summary.typescriptVersion)} (${esc(summary.typescriptSource)}) \xB7 program ${summary.programMs.toFixed(1)} ms \xB7 ${summary.fileCount} files</div>
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
  panel.webview.onDidReceiveMessage(async (m) => {
    const doc = await vscode5.workspace.openTextDocument(vscode5.Uri.file(m.file));
    const editor = await vscode5.window.showTextDocument(doc, vscode5.ViewColumn.One);
    const pos = new vscode5.Position(Math.max(0, m.line), 0);
    editor.revealRange(new vscode5.Range(pos, pos.translate(3)));
    editor.selection = new vscode5.Selection(pos, pos);
  });
}
function relPath(r) {
  const parts = r.file.split(/[\\/]/);
  return parts.slice(-2).join("/");
}

// src/provider/detail.ts
var vscode6 = __toESM(require("vscode"));
function esc2(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function openDetail(result) {
  const panel = vscode6.window.createWebviewPanel(
    "typemeter.detail",
    `TypeMeter \u2014 ${result.name}`,
    vscode6.ViewColumn.Beside,
    { enableScripts: true }
  );
  const attrRows = result.attribution.map(
    (a) => `<tr><td>${esc2(a.name)}</td><td>${a.ms !== null ? a.ms.toFixed(2) : "\u2014"}</td><td>${a.instantiations ?? "\u2014"}</td></tr>`
  ).join("");
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
  <h1>${esc2(result.name)}</h1>
  <div class="kind">${esc2(result.kind)} \xB7 ${esc2(relPath2(result))}:${result.line + 1}</div>

  <div class="big">${ms} ms <small>first touch (fresh checker)</small></div>

  <div class="grid">
    <div>checker instantiations</div><div>${result.instantiations}</div>
    <div>types created</div><div>${result.typesCreated}</div>
    <div>complexity grade</div><div>${esc2(c.grade)}</div>
    <div>properties (bounded)</div><div>${c.properties}</div>
    <div>union members</div><div>${c.unionMembers}</div>
    <div>intersection members</div><div>${c.intersectionMembers}</div>
    <div>structural depth</div><div>${c.depth}</div>
    <div>type string length</div><div>${c.typeStringLength}</div>
    <div>stringify time</div><div>${c.stringifyMs.toFixed(3)} ms</div>
  </div>

  <h2>Cost attribution \u2014 what this declaration pulls in</h2>
  ${attrRows ? `<table><thead><tr><th>referenced declaration</th><th>its first-touch ms</th><th>its instantiations</th></tr></thead><tbody>${attrRows}</tbody></table>` : '<div class="kind">No measured in-project references.</div>'}

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
  panel.webview.onDidReceiveMessage(async (m) => {
    if (m.cmd === "jump") {
      const doc = await vscode6.workspace.openTextDocument(vscode6.Uri.file(result.file));
      const editor = await vscode6.window.showTextDocument(doc, vscode6.ViewColumn.One);
      const pos = new vscode6.Position(Math.max(0, result.line), 0);
      editor.revealRange(new vscode6.Range(pos, pos.translate(3)));
      editor.selection = new vscode6.Selection(pos, pos);
    } else if (m.cmd === "copy") {
      vscode6.env.clipboard.writeText(JSON.stringify(result, null, 2));
      vscode6.window.setStatusBarMessage("TypeMeter: result copied as JSON", 2500);
    }
  });
}
function relPath2(r) {
  const parts = r.file.split(/[\\/]/);
  return parts.slice(-2).join("/");
}

// src/provider/xcheckview.ts
var vscode7 = __toESM(require("vscode"));
function esc3(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function openCrossCheckView(getSummary, getReport) {
  const report = getReport.report;
  const summary = getSummary.summary;
  if (!report || !summary) {
    vscode7.window.showWarningMessage("TypeMeter: run the cross-check first.");
    return;
  }
  const panel = vscode7.window.createWebviewPanel(
    "typemeter.crosscheck",
    "TypeMeter \u2014 Cross-check vs tsc",
    vscode7.ViewColumn.One,
    {}
  );
  const cov = (v) => v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
  const num = (v) => v === null ? "n/a" : v.toLocaleString();
  const ms = (v) => v === null ? "n/a" : `${v.toFixed(1)} ms`;
  const histRows = report.perFile.histogram.map(
    (h) => `<tr>
        <td class="num">${h.tscMs.toFixed(1)}</td>
        <td class="num">${h.sweepMs.toFixed(1)}</td>
        <td class="num">${h.decls}</td>
        <td class="loc">${esc3(h.file)}</td>
      </tr>`
  ).join("");
  const notes = report.notes.length ? `<ul class="notes">${report.notes.map((n) => `<li>${esc3(n)}</li>`).join("")}</ul>` : "";
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
  <h1>TypeMeter \u2014 cross-check vs tsc</h1>
  <div class="meta">tsc ${esc3(report.tsc.version ?? "(n/a)")} \xB7 --noEmit --extendedDiagnostics --generateTrace \xB7
    exit ${esc3(String(report.tsc.exitCode ?? "null"))}${report.tsc.oom ? ' \xB7 <span class="oom">OOM KILLED \u2014 partial trace parsed, reported honestly</span>' : ""}</div>

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

  <h2>Per-file histogram (top ${report.perFile.histogram.length})${report.perFile.pearson !== null ? ` \xB7 Pearson r = ${report.perFile.pearson}` : ""}</h2>
  <table>
    <thead><tr><th class="num">tsc ms</th><th class="num">sweep ms</th><th class="num">decls</th><th>file</th></tr></thead>
    <tbody>${histRows}</tbody>
  </table>
  <p class="caveat">${esc3(report.perFile.caveat)}</p>
  ${notes}
</body></html>`;
}

// src/engine/xcheck.ts
var import_child_process2 = require("child_process");
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path2 = __toESM(require("path"));
var import_module = require("module");
var require2 = (0, import_module.createRequire)(__filename);
function parseDiagnostics(stdout) {
  const d = {
    instantiations: null,
    types: null,
    checkTimeMs: null,
    totalTimeMs: null
  };
  const line = (key) => {
    const m = stdout.match(new RegExp(`^${key}:\\s+([\\d.,]+)\\s*(s|ms)?\\b`, "mi"));
    if (!m) return null;
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(v)) return null;
    if (m[2] === "s") return v * 1e3;
    return v;
  };
  d.instantiations = line("Instantiations");
  d.types = line("Types");
  d.checkTimeMs = line("Check time");
  d.totalTimeMs = line("Total time");
  return d;
}
function parseTraceFileEvents(tracePath) {
  const perFileMs = /* @__PURE__ */ new Map();
  const open = /* @__PURE__ */ new Map();
  let eventsSeen = 0;
  let brokenLines = 0;
  const fd = fs.openSync(tracePath, "r");
  const CHUNK = 1 << 20;
  const buf = Buffer.alloc(CHUNK);
  let carry = "";
  const handleLine = (raw) => {
    let line = raw.trim();
    if (!line || line === "[" || line === "]") return;
    if (line.startsWith("[{")) line = line.slice(1);
    if (line.endsWith(",")) line = line.slice(0, -1);
    if (line.endsWith("]")) line = line.slice(0, -1);
    if (!line.startsWith("{")) return;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      brokenLines++;
      return;
    }
    if (ev.ph === "B" && ev.name && typeof ev.ts === "number") {
      open.set(`${ev.name}@${ev.args?.pos ?? -1}`, ev.ts);
    } else if (ev.ph === "E" && ev.name && typeof ev.ts === "number") {
      const key = `${ev.name}@${ev.args?.pos ?? -1}`;
      const begin = open.get(key);
      if (begin !== void 0) {
        open.delete(key);
        const durMs = (ev.ts - begin) / 1e3;
        const file = ev.args?.file ?? ev.args?.path;
        if (ev.name === "checkSourceFile" && file && durMs >= 0) {
          perFileMs.set(file, (perFileMs.get(file) ?? 0) + durMs);
        }
      }
    }
    eventsSeen++;
  };
  try {
    while (true) {
      const n = fs.readSync(fd, buf, 0, CHUNK, null);
      if (n === 0) break;
      const text = carry + buf.toString("utf8", 0, n);
      const lines = text.split("\n");
      carry = lines.pop() ?? "";
      for (const raw of lines) handleLine(raw);
    }
    const tail = carry.trim();
    if (tail.length > 0) handleLine(tail);
  } finally {
    fs.closeSync(fd);
  }
  const truncated = brokenLines > 0 || !endsWithClosedArray(tracePath);
  return { perFileMs, eventsSeen, truncated };
}
function endsWithClosedArray(p) {
  const size = fs.statSync(p).size;
  if (size === 0) return true;
  const fd = fs.openSync(p, "r");
  try {
    const len = Math.min(size, 8);
    const b = Buffer.alloc(len);
    fs.readSync(fd, b, 0, len, size - len);
    const tail = b.toString("utf8").trimEnd();
    return tail.endsWith("]");
  } finally {
    fs.closeSync(fd);
  }
}
function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  if (den === 0) return null;
  return num / den;
}
function resolveTscBin(projectDir, tsconfig) {
  const cands = [
    path2.join(projectDir, "node_modules", "typescript", "bin", "tsc"),
    path2.join(__dirname, "..", "..", "node_modules", "typescript", "bin", "tsc"),
    path2.join(__dirname, "..", "..", "vendor", "typescript", "bin", "tsc")
  ];
  let dir = path2.dirname(path2.resolve(tsconfig));
  for (let i = 0; i < 6 && dir.length > 3; i++) {
    cands.unshift(path2.join(dir, "node_modules", "typescript", "bin", "tsc"));
    dir = path2.dirname(dir);
  }
  for (const c of cands) {
    if (fs.existsSync(c)) {
      let version = null;
      try {
        const mod = require2(path2.join(path2.dirname(c), "..", "lib", "typescript.js"));
        version = mod?.version ?? null;
      } catch {
      }
      return { bin: c, version };
    }
  }
  return { bin: "tsc", version: null };
}
function runCrossCheck(projectDir, tsconfig, sweep, opts = {}) {
  const cfg = tsconfig ?? sweep.tsconfig;
  const { bin, version } = resolveTscBin(projectDir, cfg);
  const traceDir = fs.mkdtempSync(path2.join(os.tmpdir(), "typemeter-xcheck-"));
  const notes = [];
  return new Promise((resolve2) => {
    const args = [
      bin,
      "--noEmit",
      "--extendedDiagnostics",
      "--generateTrace",
      traceDir,
      "-p",
      path2.resolve(cfg),
      ...opts.tscArgs ?? []
    ];
    const cp = (0, import_child_process2.spawn)(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    cp.stdout.setEncoding("utf8");
    cp.stdout.on("data", (c) => stdout += c);
    cp.stderr.setEncoding("utf8");
    cp.stderr.on("data", (c) => stderr += c);
    const timeout = setTimeout(() => {
      try {
        cp.kill("SIGKILL");
      } catch {
      }
    }, opts.timeoutMs ?? 20 * 60 * 1e3);
    timeout.unref();
    const finish = (exitCode, signal) => {
      clearTimeout(timeout);
      const diagnostics = parseDiagnostics(stdout);
      const oom = signal === "SIGKILL" || /heap out of memory/i.test(stderr) || /OOM/i.test(stderr);
      const killed = signal !== null;
      if (killed) notes.push(`tsc was terminated (signal ${signal}) \u2014 partial results are still compared.`);
      if (oom) notes.push("tsc exhausted memory (OOM kill) \u2014 the partial trace was parsed and the kill is reported, not hidden.");
      const tracePath = path2.join(traceDir, "trace.json");
      let perFileMs = /* @__PURE__ */ new Map();
      let eventsSeen = 0;
      let truncated = false;
      if (fs.existsSync(tracePath)) {
        ({ perFileMs, eventsSeen, truncated } = parseTraceFileEvents(tracePath));
      } else {
        notes.push("no trace.json produced (tsc failed before tracing started).");
      }
      if (truncated) notes.push("trace.json is truncated (tsc killed mid-write); parsed event-by-event, broken tail skipped.");
      try {
        fs.rmSync(traceDir, { recursive: true, force: true });
      } catch {
      }
      const tscInst = diagnostics.instantiations;
      const tscTypes = diagnostics.types;
      const instCov = tscInst && tscInst > 0 ? sweep.finalInstantiations / tscInst : null;
      const typeCov = tscTypes && tscTypes > 0 ? sweep.finalTypes / tscTypes : null;
      if (tscInst === null && oom) {
        notes.push("tsc died before printing Instantiations \u2014 coverage computed against the partial trace only.");
      }
      const norm = (f) => f.replace(/\\/g, "/");
      const sweepPerFile = /* @__PURE__ */ new Map();
      for (const r2 of sweep.results) {
        const k = norm(r2.file);
        const cur = sweepPerFile.get(k) ?? { ms: 0, decls: 0 };
        cur.ms += r2.firstTouchMs;
        cur.decls += 1;
        sweepPerFile.set(k, cur);
      }
      const hist = [];
      const xs = [];
      const ys = [];
      let tscProjectMs = 0;
      let seenProjectFiles = 0;
      for (const [file, ms] of perFileMs) {
        const k = norm(file);
        const sw = sweepPerFile.get(k);
        if (!sw) continue;
        tscProjectMs += ms;
        seenProjectFiles++;
        hist.push({ file: path2.basename(file), tscMs: Math.round(ms * 10) / 10, sweepMs: Math.round(sw.ms * 10) / 10, decls: sw.decls });
        xs.push(ms);
        ys.push(sw.ms);
      }
      const tscCheckMs = seenProjectFiles > 0 ? tscProjectMs : null;
      hist.sort((a, b) => b.tscMs - a.tscMs);
      const r = pearson(xs, ys);
      const report = {
        ok: perFileMs.size > 0 || diagnostics.instantiations !== null,
        tsc: { version, bin, exitCode, signal, killed, oom, diagnostics },
        counters: {
          sweepInstantiations: sweep.finalInstantiations,
          sweepTypes: sweep.finalTypes,
          tscInstantiations: tscInst,
          tscTypes,
          instantiationCoverage: instCov === null ? null : Math.round(instCov * 1e3) / 1e3,
          typeCoverage: typeCov === null ? null : Math.round(typeCov * 1e3) / 1e3
        },
        coldStart: {
          tscCheckMs: tscCheckMs === null ? null : Math.round(tscCheckMs * 10) / 10,
          sweepFirstTouchMs: Math.round(sweep.totalMs * 10) / 10,
          programMs: sweep.programMs
        },
        perFile: {
          histogram: hist.slice(0, 12),
          pearson: r === null ? null : Math.round(r * 1e3) / 1e3,
          caveat: "marginal first-touch redistributes shared prerequisites to whoever touches them first; per-file histograms are expected to differ \u2014 the totals and the compiler counters are the anchors."
        },
        notes
      };
      if (eventsSeen) {
        report.eventsSeen = eventsSeen;
      }
      resolve2(report);
    };
    cp.on("error", (e) => {
      notes.push(`failed to launch tsc: ${e.message}`);
      finish(null, null);
    });
    cp.on("close", (code, signal) => finish(code, signal));
  });
}

// src/extension.ts
var state;
var statusItem;
var lastCrossCheck = null;
function activate(context) {
  state = new MeasurementState();
  statusItem = vscode8.window.createStatusBarItem(vscode8.StatusBarAlignment.Right, 90);
  statusItem.text = "$(graph) TypeMeter";
  statusItem.tooltip = "Run TypeMeter to measure type load-time and complexity";
  statusItem.command = "typemeter.measureProject";
  statusItem.show();
  const docSelector = [
    { scheme: "file", language: "typescript" },
    { scheme: "file", language: "typescriptreact" }
  ];
  context.subscriptions.push(
    statusItem,
    vscode8.languages.registerCodeLensProvider(docSelector, new TypeMeterCodeLensProvider(state)),
    vscode8.languages.registerHoverProvider(docSelector, new TypeMeterHoverProvider(state)),
    registerCommands(context),
    registerWatch()
  );
}
function registerCommands(context) {
  const measure = async (silent = false) => {
    const target = await pickTsconfig();
    if (!target) return false;
    try {
      const summary = await vscode8.window.withProgress(
        {
          location: vscode8.ProgressLocation.Notification,
          title: "TypeMeter: measuring declarations",
          cancellable: true
        },
        (progress, token) => {
          let lastPct = -1;
          return runMeasurement(context.extensionPath, {
            ...target,
            token,
            onProgress: (done, total, file) => {
              const pct = Math.floor(done / Math.max(1, total) * 100);
              if (pct !== lastPct) {
                lastPct = pct;
                progress.report({ message: `${done}/${total} (${file})`, increment: pct - (lastPct === 0 ? 0 : 0) });
              }
            }
          });
        }
      );
      state.set(summary);
      statusItem.text = `$(graph) ${summary.declCount} decls \xB7 ${summary.totalMs.toFixed(0)} ms`;
      statusItem.tooltip = `TypeMeter: ${summary.declCount} declarations \xB7 total first-touch ${summary.totalMs.toFixed(1)} ms \xB7 TS ${summary.typescriptVersion} (${summary.typescriptSource})`;
      if (!silent) {
        const open = await vscode8.window.showInformationMessage(
          `TypeMeter: measured ${summary.declCount} declarations in ${summary.totalMs.toFixed(1)} ms.`,
          "Show slowest types"
        );
        if (open === "Show slowest types") openLeaderboard({ get summary() {
          return state.summary;
        } });
      }
      return true;
    } catch (e) {
      if (!silent) {
        vscode8.window.showErrorMessage(`TypeMeter: ${e instanceof Error ? e.message : String(e)}`);
      }
      return false;
    }
  };
  const showDetailFor = (fileStr, line) => {
    let fsPath = fileStr;
    try {
      fsPath = vscode8.Uri.parse(fileStr).fsPath;
    } catch {
    }
    const r = state.nearest(fsPath, line);
    if (!r) {
      vscode8.window.showWarningMessage('TypeMeter: no measurement for this file \u2014 run "Measure Project Types".');
      return;
    }
    openDetail(r);
  };
  const runXCheck = async () => {
    const target = await pickTsconfig();
    if (!target) return;
    try {
      const summary = await vscode8.window.withProgress(
        {
          location: vscode8.ProgressLocation.Notification,
          title: "TypeMeter: measuring declarations",
          cancellable: true
        },
        (progress, token) => runMeasurement(context.extensionPath, { ...target, token })
      );
      state.set(summary);
      await vscode8.window.withProgress(
        { location: vscode8.ProgressLocation.Notification, title: "TypeMeter: running tsc cross-check" },
        () => runCrossCheck(target.projectDir, target.tsconfig, summary).then((r) => {
          lastCrossCheck = r;
        })
      );
      openCrossCheckView({ get summary() {
        return state.summary;
      } }, { get report() {
        return lastCrossCheck;
      } });
    } catch (e) {
      vscode8.window.showErrorMessage(`TypeMeter: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return vscode8.Disposable.from(
    vscode8.commands.registerCommand("typemeter.measureProject", () => measure(false)),
    vscode8.commands.registerCommand("typemeter.crossCheck", () => runXCheck()),
    vscode8.commands.registerCommand("typemeter.measureAtCursor", async () => {
      const editor = vscode8.window.activeTextEditor;
      if (!editor) return;
      if (!state.hasFile(editor.document.uri.fsPath)) {
        const ok = await measure(false);
        if (!ok) return;
      }
      const r = state.nearest(editor.document.uri.fsPath, editor.selection.active.line);
      if (!r) {
        vscode8.window.showInformationMessage("TypeMeter: no declaration measured near the cursor.");
        return;
      }
      openDetail(r);
    }),
    vscode8.commands.registerCommand("typemeter.showLeaderboard", () => openLeaderboard({ get summary() {
      return state.summary;
    } })),
    vscode8.commands.registerCommand("typemeter.showDetail", (fileStr, line) => showDetailFor(fileStr, line))
  );
}
function registerWatch() {
  let timer;
  return vscode8.workspace.onDidSaveTextDocument((doc) => {
    if (doc.languageId !== "typescript" && doc.languageId !== "typescriptreact") return;
    const enabled = vscode8.workspace.getConfiguration("typemeter").get("watchOnSave", false);
    if (!enabled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void vscode8.commands.executeCommand("typemeter.measureProject");
    }, 2e3);
  });
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
