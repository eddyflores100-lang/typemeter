#!/usr/bin/env node
/**
 * TypeMeter headless CLI — CI-friendly type cost report.
 *
 *   node dist/cli.js <projectDir> [--tsconfig path] [--json] [--top N]
 *
 * Measures every declaration's first-touch cost (compiler-level) in a fresh
 * worker process and prints a ranked report (or machine-readable JSON).
 */
import { spawn } from 'child_process';
import * as path from 'path';
import { RunSummary, WorkerLine, DeclResult } from './engine/metrics';

interface CliOpts {
  projectDir: string;
  tsconfig?: string;
  json: boolean;
  top: number;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { projectDir: process.cwd(), json: false, top: 25 };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--tsconfig') opts.tsconfig = path.resolve(argv[++i]);
    else if (a === '--top') opts.top = parseInt(argv[++i], 10) || 25;
    else if (a === '--help' || a === '-h') {
      console.log('usage: typemeter <projectDir> [--tsconfig path] [--json] [--top N]');
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

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  try {
    const summary = await runWorker(opts);
    if (!opts.json) process.stderr.write('\n');
    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`TypeMeter — TypeScript type cost report`);
      console.log(`  TS ${summary.typescriptVersion} (${summary.typescriptSource}) · ${summary.fileCount} files · ${summary.declCount} declarations`);
      console.log(`  program: ${summary.programMs.toFixed(1)} ms · total first-touch: ${summary.totalMs.toFixed(1)} ms`);
      console.log('');
      console.log(`${'ms'.padStart(11)} ${'inst'.padStart(12)} ${'types'.padStart(11)}  grade  name`);
      for (const r of summary.results.slice(0, opts.top)) console.log(fmtRow(r));
    }
  } catch (e) {
    console.error(`typemeter: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

main();
