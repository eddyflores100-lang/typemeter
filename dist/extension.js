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
var vscode7 = __toESM(require("vscode"));

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
  return new Promise((resolve, reject) => {
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
          finish(() => resolve(s));
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

// src/extension.ts
var state;
var statusItem;
function activate(context) {
  state = new MeasurementState();
  statusItem = vscode7.window.createStatusBarItem(vscode7.StatusBarAlignment.Right, 90);
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
    vscode7.languages.registerCodeLensProvider(docSelector, new TypeMeterCodeLensProvider(state)),
    vscode7.languages.registerHoverProvider(docSelector, new TypeMeterHoverProvider(state)),
    registerCommands(context),
    registerWatch()
  );
}
function registerCommands(context) {
  const measure = async (silent = false) => {
    const target = await pickTsconfig();
    if (!target) return false;
    try {
      const summary = await vscode7.window.withProgress(
        {
          location: vscode7.ProgressLocation.Notification,
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
        const open = await vscode7.window.showInformationMessage(
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
        vscode7.window.showErrorMessage(`TypeMeter: ${e instanceof Error ? e.message : String(e)}`);
      }
      return false;
    }
  };
  const showDetailFor = (fileStr, line) => {
    let fsPath = fileStr;
    try {
      fsPath = vscode7.Uri.parse(fileStr).fsPath;
    } catch {
    }
    const r = state.nearest(fsPath, line);
    if (!r) {
      vscode7.window.showWarningMessage('TypeMeter: no measurement for this file \u2014 run "Measure Project Types".');
      return;
    }
    openDetail(r);
  };
  return vscode7.Disposable.from(
    vscode7.commands.registerCommand("typemeter.measureProject", () => measure(false)),
    vscode7.commands.registerCommand("typemeter.measureAtCursor", async () => {
      const editor = vscode7.window.activeTextEditor;
      if (!editor) return;
      if (!state.hasFile(editor.document.uri.fsPath)) {
        const ok = await measure(false);
        if (!ok) return;
      }
      const r = state.nearest(editor.document.uri.fsPath, editor.selection.active.line);
      if (!r) {
        vscode7.window.showInformationMessage("TypeMeter: no declaration measured near the cursor.");
        return;
      }
      openDetail(r);
    }),
    vscode7.commands.registerCommand("typemeter.showLeaderboard", () => openLeaderboard({ get summary() {
      return state.summary;
    } })),
    vscode7.commands.registerCommand("typemeter.showDetail", (fileStr, line) => showDetailFor(fileStr, line))
  );
}
function registerWatch() {
  let timer;
  return vscode7.workspace.onDidSaveTextDocument((doc) => {
    if (doc.languageId !== "typescript" && doc.languageId !== "typescriptreact") return;
    const enabled = vscode7.workspace.getConfiguration("typemeter").get("watchOnSave", false);
    if (!enabled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void vscode7.commands.executeCommand("typemeter.measureProject");
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
