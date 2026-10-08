#!/usr/bin/env node
/**
 * TypeMeter headless CLI — CI-friendly type cost report.
 *
 *   node dist/cli.js <projectDir> [--tsconfig path] [--json] [--top N] [--crosscheck]
 *
 * Measures every declaration's first-touch cost (compiler-level) in a fresh
 * worker process and prints a ranked report (or machine-readable JSON).
 * `--crosscheck` additionally runs the project's own tsc
 * (--extendedDiagnostics --generateTrace) and validates TypeMeter's counters
 * and cold-start totals against the compiler's own instrumentation.
 */
import { spawn } from 'child_process';
import * as path from 'path';
import { RunSummary, WorkerLine, DeclResult } from './engine/metrics';
import { runCrossCheck, CrossCheckReport } from './engine/xcheck';

interface CliOpts {
  projectDir: string;
  tsconfig?: string;
  json: boolean;
  top: number;
  crosscheck: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { projectDir: process.cwd(), json: false, top: 25, crosscheck: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--crosscheck') opts.crosscheck = true;
    else if (a === '--tsconfig') opts.tsconfig = path.resolve(argv[++i]);
    else if (a === '--top') opts.top = parseInt(argv[++i], 10) || 25;
    else if (a === '--help' || a === '-h') {
      console.log('usage: typemeter <projectDir> [--tsconfig path] [--json] [--top N] [--crosscheck]');
      process.exit(0);
    } else rest.push(a);
  }
  if (rest[0]) opts.projectDir = path.resolve(rest[0]);
  return opts;
}

function runWorker(opts: CliOpts): Promise<RunSummary> {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'engine', 'worker.js');
    const args = [workerPath, '--project', opts.projectDir];
    if (opts.tsconfig) args.push('--tsconfig', opts.tsconfig);
    const cp = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    let stderr = '';
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
          if (!opts.json) {
            process.stderr.write(`\r  measured ${parsed.done}/${parsed.total} (${parsed.file})`);
          }
        } else if (parsed.type === 'summary') {
          resolve(parsed.summary);
        } else if (parsed.type === 'error') {
          reject(new Error(parsed.message));
        }
      }
    });
    cp.stderr.setEncoding('utf8');
    cp.stderr.on('data', (c: string) => (stderr += c));
    cp.on('error', reject);
    cp.on('close', (code) => {
      if (code !== 0 && stderr) reject(new Error(`worker exited ${code}: ${stderr.slice(0, 500)}`));
    });
    const timeout = setTimeout(() => {
      cp.kill();
      reject(new Error('worker timed out after 10 minutes'));
    }, 10 * 60 * 1000);
    timeout.unref();
  });
}

function fmtRow(r: DeclResult): string {
  const rel = r.file.split(/[\\/]/).slice(-2).join('/');
  const ms = r.firstTouchMs >= 100 ? r.firstTouchMs.toFixed(0) : r.firstTouchMs.toFixed(2);
  return `${String(ms).padStart(9)} ms ${String(r.instantiations).padStart(7)} inst ${String(r.typesCreated).padStart(7)} typ ${r.complexity.grade}  ${r.name.slice(0, 34).padEnd(34)} ${rel}:${r.line + 1}`;
}

function fmtCrossCheck(cc: CrossCheckReport): string[] {
  const L: string[] = [];
  const cov = (v: number | null): string =>
    v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`;
  L.push('Cross-check vs tsc (--extendedDiagnostics --generateTrace)');
  L.push(`  tsc ${cc.tsc.version ?? '(version n/a)'} · exit ${cc.tsc.exitCode ?? 'null'}${cc.tsc.oom ? ' · OOM KILLED (reported honestly, partial trace parsed)' : ''}`);
  L.push(`  counters: sweep ${cc.counters.sweepInstantiations.toLocaleString()} inst / ${cc.counters.sweepTypes.toLocaleString()} types`);
  L.push(`           tsc   ${(cc.counters.tscInstantiations ?? 0).toLocaleString()} inst / ${(cc.counters.tscTypes ?? 0).toLocaleString()} types`);
  L.push(`  coverage: instantiations ${cov(cc.counters.instantiationCoverage)} · types ${cov(cc.counters.typeCoverage)}`);
  L.push(`  cold-start: tsc check ${cc.coldStart.tscCheckMs === null ? 'n/a' : cc.coldStart.tscCheckMs.toFixed(0) + ' ms'} vs first-touch ${cc.coldStart.sweepFirstTouchMs.toFixed(0)} ms + program ${cc.coldStart.programMs.toFixed(0)} ms`);
  if (cc.perFile.pearson !== null) {
    L.push(`  per-file Pearson r (tsc ms vs sweep ms): ${cc.perFile.pearson}`);
  }
  if (cc.perFile.histogram.length) {
    L.push('  per-file histogram (top):');
    for (const h of cc.perFile.histogram.slice(0, 5)) {
      L.push(`    ${String(h.tscMs.toFixed(1)).padStart(9)} ms tsc · ${String(h.sweepMs.toFixed(1)).padStart(8)} ms sweep · ${h.decls} decls · ${h.file}`);
    }
    L.push(`    (caveat: ${cc.perFile.caveat})`);
  }
  for (const n of cc.notes) L.push(`  note: ${n}`);
  return L;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  try {
    const summary = await runWorker(opts);
    if (!opts.json) process.stderr.write('\n');
    if (opts.crosscheck) {
      const cc = await runCrossCheck(opts.projectDir, opts.tsconfig, summary);
      (summary as RunSummary & { crossCheck: CrossCheckReport }).crossCheck = cc;
    }
    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`TypeMeter — TypeScript type cost report`);
      console.log(`  TS ${summary.typescriptVersion} (${summary.typescriptSource}) · ${summary.fileCount} files · ${summary.declCount} declarations`);
      console.log(`  program: ${summary.programMs.toFixed(1)} ms · total first-touch: ${summary.totalMs.toFixed(1)} ms`);
      console.log('');
      console.log(`${'ms'.padStart(11)} ${'inst'.padStart(12)} ${'types'.padStart(11)}  grade  name`);
      for (const r of summary.results.slice(0, opts.top)) console.log(fmtRow(r));
      const cc = (summary as RunSummary & { crossCheck?: CrossCheckReport }).crossCheck;
      if (cc) {
        console.log('');
        for (const line of fmtCrossCheck(cc)) console.log(line);
      }
    }
  } catch (e) {
    console.error(`typemeter: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

main();
