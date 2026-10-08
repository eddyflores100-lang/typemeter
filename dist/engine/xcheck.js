"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTraceFileEvents = parseTraceFileEvents;
exports.runCrossCheck = runCrossCheck;
/**
 * Cross-check: validate TypeMeter's numbers against the compiler's own
 * instrumentation by running the project's `tsc --noEmit --extendedDiagnostics
 * --generateTrace` and comparing:
 *
 *   1. Counter identity  — sweep-cumulative getInstantiationCount() /
 *      getTypeCount() vs tsc's whole-program `Instantiations:` / `Types:`.
 *   2. Cold-start totals — tsc's per-file `checkSourceFile` durations (from
 *      trace.json) summed over project files vs TypeMeter first-touch +
 *      program construction.
 *   3. OOM survival      — when tsc is killed by the OOM killer, the partial
 *      trace is still parsed (streamed, truncation-tolerant) and the kill is
 *      reported honestly.
 *
 * Per-file histograms are printed with an explicit caveat: marginal
 * first-touch redistributes shared costs, so per-file numbers are expected to
 * differ — the totals and the counters are the anchors.
 */
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const module_1 = require("module");
const require2 = (0, module_1.createRequire)(__filename);
/** number-ish token from an --extendedDiagnostics line, e.g. "Instantiations: 100887" */
function parseDiagnostics(stdout) {
    const d = {
        instantiations: null,
        types: null,
        checkTimeMs: null,
        totalTimeMs: null,
    };
    const line = (key) => {
        const m = stdout.match(new RegExp(`^${key}:\\s+([\\d.,]+)\\s*(s|ms)?\\b`, 'mi'));
        if (!m)
            return null;
        const v = parseFloat(m[1].replace(/,/g, ''));
        if (!Number.isFinite(v))
            return null;
        if (m[2] === 's')
            return v * 1000;
        return v;
    };
    d.instantiations = line('Instantiations');
    d.types = line('Types');
    d.checkTimeMs = line('Check time');
    d.totalTimeMs = line('Total time');
    return d;
}
/**
 * Streamed, truncation-tolerant trace.json reader.
 * The trace format is one JSON object per array element separated by newlines;
 * when tsc is SIGKILLed mid-write the file is a truncated array. We parse line
 * by line and simply skip anything that does not parse.
 */
function parseTraceFileEvents(tracePath) {
    const perFileMs = new Map();
    const open = new Map(); // name@pos -> begin ts (us)
    let eventsSeen = 0;
    let brokenLines = 0;
    const fd = fs.openSync(tracePath, 'r');
    const CHUNK = 1 << 20;
    const buf = Buffer.alloc(CHUNK);
    let carry = '';
    const handleLine = (raw) => {
        let line = raw.trim();
        if (!line || line === '[' || line === ']')
            return;
        // de-glue array punctuation: '[{...}' (first line), '...},', '...}]' (last line)
        if (line.startsWith('[{'))
            line = line.slice(1);
        if (line.endsWith(','))
            line = line.slice(0, -1);
        if (line.endsWith(']'))
            line = line.slice(0, -1);
        if (!line.startsWith('{'))
            return;
        let ev;
        try {
            ev = JSON.parse(line);
        }
        catch {
            // mid-object truncation inside a single line — tolerate, count it
            brokenLines++;
            return;
        }
        if (ev.ph === 'B' && ev.name && typeof ev.ts === 'number') {
            open.set(`${ev.name}@${ev.args?.pos ?? -1}`, ev.ts);
        }
        else if (ev.ph === 'E' && ev.name && typeof ev.ts === 'number') {
            const key = `${ev.name}@${ev.args?.pos ?? -1}`;
            const begin = open.get(key);
            if (begin !== undefined) {
                open.delete(key);
                const durMs = (ev.ts - begin) / 1000;
                // tsc names it args.path in checkSourceFile events (older builds: args.file)
                const file = ev.args?.file ?? ev.args?.path;
                if (ev.name === 'checkSourceFile' && file && durMs >= 0) {
                    perFileMs.set(file, (perFileMs.get(file) ?? 0) + durMs);
                }
            }
        }
        eventsSeen++;
    };
    try {
        while (true) {
            const n = fs.readSync(fd, buf, 0, CHUNK, null);
            if (n === 0)
                break;
            const text = carry + buf.toString('utf8', 0, n);
            const lines = text.split('\n');
            carry = lines.pop() ?? '';
            for (const raw of lines)
                handleLine(raw);
        }
        const tail = carry.trim();
        if (tail.length > 0)
            handleLine(tail);
    }
    finally {
        fs.closeSync(fd);
    }
    // a complete trace ends with the array's closing ']' (possibly followed by
    // whitespace); anything else (or unparseable inner lines) means it was cut
    // mid-write — report, don't hide.
    const truncated = brokenLines > 0 || !endsWithClosedArray(tracePath);
    return { perFileMs, eventsSeen, truncated };
}
function endsWithClosedArray(p) {
    const size = fs.statSync(p).size;
    if (size === 0)
        return true;
    const fd = fs.openSync(p, 'r');
    try {
        const len = Math.min(size, 8);
        const b = Buffer.alloc(len);
        fs.readSync(fd, b, 0, len, size - len);
        const tail = b.toString('utf8').trimEnd();
        return tail.endsWith(']');
    }
    finally {
        fs.closeSync(fd);
    }
}
function pearson(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    if (n < 3)
        return null;
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
    if (den === 0)
        return null;
    return num / den;
}
/** Resolve the tsc CLI the SAME way the worker resolved the TS module. */
function resolveTscBin(projectDir, tsconfig) {
    const cands = [
        path.join(projectDir, 'node_modules', 'typescript', 'bin', 'tsc'),
        path.join(__dirname, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc'),
        path.join(__dirname, '..', '..', 'vendor', 'typescript', 'bin', 'tsc'),
    ];
    // tsconfig dir may sit deeper in a monorepo — try its node_modules chain too
    let dir = path.dirname(path.resolve(tsconfig));
    for (let i = 0; i < 6 && dir.length > 3; i++) {
        cands.unshift(path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc'));
        dir = path.dirname(dir);
    }
    for (const c of cands) {
        if (fs.existsSync(c)) {
            let version = null;
            try {
                // lib/ is a SIBLING of the bin/ directory: <ts>/bin/tsc + <ts>/lib/typescript.js
                const mod = require2(path.join(path.dirname(c), '..', 'lib', 'typescript.js'));
                version = mod?.version ?? null;
            }
            catch {
                /* version stays null */
            }
            return { bin: c, version };
        }
    }
    return { bin: 'tsc', version: null };
}
function runCrossCheck(projectDir, tsconfig, sweep, opts = {}) {
    const cfg = tsconfig ?? sweep.tsconfig;
    const { bin, version } = resolveTscBin(projectDir, cfg);
    const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typemeter-xcheck-'));
    const notes = [];
    return new Promise((resolve) => {
        const args = [
            bin,
            '--noEmit',
            '--extendedDiagnostics',
            '--generateTrace',
            traceDir,
            '-p',
            path.resolve(cfg),
            ...(opts.tscArgs ?? []),
        ];
        const cp = (0, child_process_1.spawn)(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        cp.stdout.setEncoding('utf8');
        cp.stdout.on('data', (c) => (stdout += c));
        cp.stderr.setEncoding('utf8');
        cp.stderr.on('data', (c) => (stderr += c));
        const timeout = setTimeout(() => {
            try {
                cp.kill('SIGKILL');
            }
            catch {
                /* gone */
            }
        }, opts.timeoutMs ?? 20 * 60 * 1000);
        timeout.unref();
        const finish = (exitCode, signal) => {
            clearTimeout(timeout);
            const diagnostics = parseDiagnostics(stdout);
            const oom = signal === 'SIGKILL' || /heap out of memory/i.test(stderr) || /OOM/i.test(stderr);
            const killed = signal !== null;
            if (killed)
                notes.push(`tsc was terminated (signal ${signal}) — partial results are still compared.`);
            if (oom)
                notes.push('tsc exhausted memory (OOM kill) — the partial trace was parsed and the kill is reported, not hidden.');
            // ---- trace parse (truncation tolerant) ----
            const tracePath = path.join(traceDir, 'trace.json');
            let perFileMs = new Map();
            let eventsSeen = 0;
            let truncated = false;
            if (fs.existsSync(tracePath)) {
                ({ perFileMs, eventsSeen, truncated } = parseTraceFileEvents(tracePath));
            }
            else {
                notes.push('no trace.json produced (tsc failed before tracing started).');
            }
            if (truncated)
                notes.push('trace.json is truncated (tsc killed mid-write); parsed event-by-event, broken tail skipped.');
            try {
                fs.rmSync(traceDir, { recursive: true, force: true });
            }
            catch {
                /* temp dir cleanup is best-effort */
            }
            // ---- counter identity ----
            const tscInst = diagnostics.instantiations;
            const tscTypes = diagnostics.types;
            const instCov = tscInst && tscInst > 0 ? sweep.finalInstantiations / tscInst : null;
            const typeCov = tscTypes && tscTypes > 0 ? sweep.finalTypes / tscTypes : null;
            if (tscInst === null && oom) {
                notes.push('tsc died before printing Instantiations — coverage computed against the partial trace only.');
            }
            // ---- cold-start totals over PROJECT files ----
            const norm = (f) => f.replace(/\\/g, '/');
            const sweepPerFile = new Map();
            for (const r of sweep.results) {
                const k = norm(r.file);
                const cur = sweepPerFile.get(k) ?? { ms: 0, decls: 0 };
                cur.ms += r.firstTouchMs;
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
                if (!sw)
                    continue; // lib .d.ts and other non-project files are not ours to claim
                tscProjectMs += ms;
                seenProjectFiles++;
                hist.push({ file: path.basename(file), tscMs: Math.round(ms * 10) / 10, sweepMs: Math.round(sw.ms * 10) / 10, decls: sw.decls });
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
                    instantiationCoverage: instCov === null ? null : Math.round(instCov * 1000) / 1000,
                    typeCoverage: typeCov === null ? null : Math.round(typeCov * 1000) / 1000,
                },
                coldStart: {
                    tscCheckMs: tscCheckMs === null ? null : Math.round(tscCheckMs * 10) / 10,
                    sweepFirstTouchMs: Math.round(sweep.totalMs * 10) / 10,
                    programMs: sweep.programMs,
                },
                perFile: {
                    histogram: hist.slice(0, 12),
                    pearson: r === null ? null : Math.round(r * 1000) / 1000,
                    caveat: 'marginal first-touch redistributes shared prerequisites to whoever touches them first; per-file histograms are expected to differ — the totals and the compiler counters are the anchors.',
                },
                notes,
            };
            if (eventsSeen) {
                report.eventsSeen = eventsSeen;
            }
            resolve(report);
        };
        cp.on('error', (e) => {
            notes.push(`failed to launch tsc: ${e.message}`);
            finish(null, null);
        });
        cp.on('close', (code, signal) => finish(code, signal));
    });
}
