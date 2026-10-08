/**
 * TypeMeter measurement worker.
 *
 * Runs in a FRESH node process so that measurement runs are comparable and
 * nothing pollutes the editor's language service. Uses the project's own
 * TypeScript from node_modules when present, else the bundled/vendored copy.
 *
 * Protocol (stdout, NDJSON):
 *   {"type":"progress","done":n,"total":m,"file":"..."}
 *   {"type":"summary","summary":{...}} | {"type":"error","message":"..."}
 */
import * as path from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { collectDeclarations } from './declarations';
import { walkType } from './structwalk';
import { collectTypeRefs } from './astrefs';
import { DeclResult, RefCost, RunSummary, gradeOf } from './metrics';

const require2 = createRequire(__filename);

interface ResolvedTS {
  module: typeof ts;
  source: 'project' | 'bundled' | 'vendored';
  version: string;
}

function resolveTypeScript(projectDir: string): ResolvedTS {
  const candidates: Array<{ p: string; source: ResolvedTS['source'] }> = [
    { p: path.join(projectDir, 'node_modules', 'typescript'), source: 'project' },
    { p: path.join(__dirname, '..', '..', 'node_modules', 'typescript'), source: 'bundled' },
    { p: path.join(__dirname, '..', 'vendor', 'typescript', 'lib', 'typescript.js'), source: 'vendored' },
  ];
  for (const c of candidates) {
    try {
      const mod = require2(c.p) as typeof ts;
      if (mod && typeof mod.createLanguageService === 'function') {
        return { module: mod, source: c.source, version: mod.version };
      }
    } catch {
      /* try next candidate */
    }
  }
  throw new Error('TypeScript module not found (project, bundled or vendored)');
}

function parseArgs(argv: string[]): { projectDir: string; tsconfig?: string } {
  const out = { projectDir: process.cwd(), tsconfig: undefined as string | undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') out.projectDir = path.resolve(argv[++i]);
    else if (argv[i] === '--tsconfig') out.tsconfig = path.resolve(argv[++i]);
  }
  return out;
}

function emit(line: unknown): void {
  process.stdout.write(JSON.stringify(line) + '\n');
}

function main(): void {
  const { projectDir, tsconfig: tsconfigArg } = parseArgs(process.argv.slice(2));
  try {
    const rts = resolveTypeScript(projectDir);
    const T = rts.module;
    const readInstantiations = (checker: import('typescript').TypeChecker): number => {
      try {
        return (checker as unknown as { getInstantiationCount?: () => number }).getInstantiationCount?.() ?? 0;
      } catch {
        return 0;
      }
    };
    const readTypeCount = (checker: import('typescript').TypeChecker): number => {
      try {
        return (checker as unknown as { getTypeCount?: () => number }).getTypeCount?.() ?? 0;
      } catch {
        return 0;
      }
    };

    const cfgPath =
      tsconfigArg ??
      T.findConfigFile(projectDir, T.sys.fileExists, 'tsconfig.json');
    if (!cfgPath) throw new Error(`No tsconfig.json found under ${projectDir}`);
    const raw = T.readConfigFile(cfgPath, T.sys.readFile);
    if (raw.error) throw new Error(`Failed to read tsconfig: ${cfgPath}`);
    const parsed = T.parseJsonConfigFileContent(
      (raw.config ?? {}) as Record<string, unknown>,
      T.sys,
      path.dirname(cfgPath),
      { noEmit: true },
      cfgPath
    );

    const files = parsed.fileNames.filter((f) => /\.(ts|tsx|mts|cts)$/.test(f));
    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => files,
      getScriptVersion: () => '1',
      getScriptSnapshot: (fileName: string) => {
        if (!T.sys.fileExists(fileName)) return undefined;
        return T.ScriptSnapshot.fromString(T.sys.readFile(fileName) ?? '');
      },
      getCurrentDirectory: () => projectDir,
      getCompilationSettings: () => parsed.options,
      getDefaultLibFileName: (opts) => T.getDefaultLibFilePath(opts),
      fileExists: T.sys.fileExists,
      readFile: T.sys.readFile,
      readDirectory: T.sys.readDirectory,
      directoryExists: T.sys.directoryExists,
      getDirectories: T.sys.getDirectories,
    };

    const tProgram0 = process.hrtime.bigint();
    const ls = T.createLanguageService(host, T.createDocumentRegistry());
    const program = ls.getProgram();
    if (!program) throw new Error('Failed to create program');
    const programMs = Number(process.hrtime.bigint() - tProgram0) / 1e6;
    const checker = program.getTypeChecker();

    const results: DeclResult[] = [];
    const walkRefsPerDecl = new Map<DeclResult, Map<string, number>>();
    const astRefsPerDecl = new Map<DeclResult, Map<string, number>>();

    const projectFiles = files.filter((f) => f.startsWith(projectDir));
    let done = 0;
    for (const file of projectFiles) {
      const sf = program.getSourceFile(file);
      if (!sf) continue;
      const decls = collectDeclarations(sf as unknown as import('typescript').SourceFile, checker as unknown as import('typescript').TypeChecker);

      for (const d of decls) {
        const target = d.nameNode ?? d.node;
        const inst0 = readInstantiations(checker as unknown as import('typescript').TypeChecker);
        const created0 = readTypeCount(checker as unknown as import('typescript').TypeChecker);
        const t0 = process.hrtime.bigint();
        let type: import('typescript').Type | undefined;
        try {
          type = checker.getTypeAtLocation(target as unknown as import('typescript').Node);
        } catch {
          type = undefined;
        }
        let w: ReturnType<typeof walkType> | null = null;
        try {
          w = type ? walkType(type, checker as unknown as import('typescript').TypeChecker) : null;
        } catch {
          w = null;
        }
        const firstTouchMs = Number(process.hrtime.bigint() - t0) / 1e6;
        const instantiations = Math.max(0, readInstantiations(checker as unknown as import('typescript').TypeChecker) - inst0);
        const typesCreated = Math.max(0, readTypeCount(checker as unknown as import('typescript').TypeChecker) - created0);

        let typeStringLength = 0;
        let stringifyMs = 0;
        if (type) {
          const ts0 = process.hrtime.bigint();
          try {
            typeStringLength = checker.typeToString(type).length;
          } catch {
            typeStringLength = 0;
          }
          stringifyMs = Number(process.hrtime.bigint() - ts0) / 1e6;
        }

        const complexity = {
          properties: w?.properties ?? 0,
          unionMembers: w?.unionMembers ?? 0,
          intersectionMembers: w?.intersectionMembers ?? 0,
          depth: w?.depth ?? 0,
          typeStringLength,
          stringifyMs,
          grade: gradeOf({
            properties: w?.properties ?? 0,
            unionMembers: w?.unionMembers ?? 0,
            depth: w?.depth ?? 0,
            typeStringLength,
          }),
        };

        const pushed: DeclResult = {
          file,
          line: d.line,
          col: d.col,
          name: d.name,
          kind: d.kind,
          firstTouchMs: Math.round(firstTouchMs * 1000) / 1000,
          instantiations,
          typesCreated,
          complexity,
          attribution: [], // joined in phase 2
        };
        results.push(pushed);
        if (w) walkRefsPerDecl.set(pushed, w.refs);
        astRefsPerDecl.set(pushed, collectTypeRefs(d.node as unknown as import('typescript').Node));
      }
      done++;
      emit({ type: 'progress', done, total: projectFiles.length, file: path.basename(file) });
    }

    // phase 2: attribution join (each declaration's OWN referenced types -> measured costs)
    const byName = new Map<string, DeclResult>();
    for (const r of results) if (!byName.has(r.name)) byName.set(r.name, r);
    for (const r of results) {
      const walkRefs = walkRefsPerDecl.get(r);
      const astRefs = astRefsPerDecl.get(r);
      if (!walkRefs && !astRefs) continue;
      const merged = new Map<string, number>(astRefs ?? []);
      if (walkRefs) {
        for (const [name, count] of walkRefs) merged.set(name, (merged.get(name) ?? 0) + count);
      }
      const refs = merged;
      const matched: RefCost[] = [];
      for (const [name] of refs) {
        const hit = byName.get(name);
        if (hit && hit.name !== r.name) {
          matched.push({ name: hit.name, ms: hit.firstTouchMs, instantiations: hit.instantiations });
        }
      }
      matched.sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0));
      r.attribution = matched.slice(0, 5);
    }

    const summary: RunSummary = {
      projectDir,
      tsconfig: cfgPath,
      typescriptVersion: rts.version,
      typescriptSource: rts.source,
      fileCount: projectFiles.length,
      declCount: results.length,
      totalMs: Math.round(results.reduce((s, r) => s + r.firstTouchMs, 0) * 1000) / 1000,
      programMs: Math.round(programMs * 1000) / 1000,
      results: results.sort((a, b) => b.firstTouchMs - a.firstTouchMs),
    };
    emit({ type: 'summary', summary });
  } catch (err) {
    emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  }
}

main();
