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
const path = __importStar(require("path"));
const module_1 = require("module");
const declarations_1 = require("./declarations");
const structwalk_1 = require("./structwalk");
const astrefs_1 = require("./astrefs");
const metrics_1 = require("./metrics");
const require2 = (0, module_1.createRequire)(__filename);
function resolveTypeScript(projectDir) {
    const candidates = [
        { p: path.join(projectDir, 'node_modules', 'typescript'), source: 'project' },
        { p: path.join(__dirname, '..', '..', 'node_modules', 'typescript'), source: 'bundled' },
        { p: path.join(__dirname, '..', 'vendor', 'typescript', 'lib', 'typescript.js'), source: 'vendored' },
    ];
    for (const c of candidates) {
        try {
            const mod = require2(c.p);
            if (mod && typeof mod.createLanguageService === 'function') {
                return { module: mod, source: c.source, version: mod.version };
            }
        }
        catch {
            /* try next candidate */
        }
    }
    throw new Error('TypeScript module not found (project, bundled or vendored)');
}
function parseArgs(argv) {
    const out = { projectDir: process.cwd(), tsconfig: undefined };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--project')
            out.projectDir = path.resolve(argv[++i]);
        else if (argv[i] === '--tsconfig')
            out.tsconfig = path.resolve(argv[++i]);
    }
    return out;
}
function emit(line) {
    process.stdout.write(JSON.stringify(line) + '\n');
}
function main() {
    const { projectDir, tsconfig: tsconfigArg } = parseArgs(process.argv.slice(2));
    try {
        const rts = resolveTypeScript(projectDir);
        const T = rts.module;
        const readInstantiations = (checker) => {
            try {
                return checker.getInstantiationCount?.() ?? 0;
            }
            catch {
                return 0;
            }
        };
        const readTypeCount = (checker) => {
            try {
                return checker.getTypeCount?.() ?? 0;
            }
            catch {
                return 0;
            }
        };
        const cfgPath = tsconfigArg ??
            T.findConfigFile(projectDir, T.sys.fileExists, 'tsconfig.json');
        if (!cfgPath)
            throw new Error(`No tsconfig.json found under ${projectDir}`);
        const raw = T.readConfigFile(cfgPath, T.sys.readFile);
        if (raw.error)
            throw new Error(`Failed to read tsconfig: ${cfgPath}`);
        const parsed = T.parseJsonConfigFileContent((raw.config ?? {}), T.sys, path.dirname(cfgPath), { noEmit: true }, cfgPath);
        const files = parsed.fileNames.filter((f) => /\.(ts|tsx|mts|cts)$/.test(f));
        const host = {
            getScriptFileNames: () => files,
            getScriptVersion: () => '1',
            getScriptSnapshot: (fileName) => {
                if (!T.sys.fileExists(fileName))
                    return undefined;
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
        if (!program)
            throw new Error('Failed to create program');
        const programMs = Number(process.hrtime.bigint() - tProgram0) / 1e6;
        const checker = program.getTypeChecker();
        const results = [];
        const walkRefsPerDecl = new Map();
        const astRefsPerDecl = new Map();
        const projectFiles = files.filter((f) => f.startsWith(projectDir));
        let done = 0;
        for (const file of projectFiles) {
            const sf = program.getSourceFile(file);
            if (!sf)
                continue;
            const decls = (0, declarations_1.collectDeclarations)(sf, checker);
            for (const d of decls) {
                const target = d.nameNode ?? d.node;
                const inst0 = readInstantiations(checker);
                const created0 = readTypeCount(checker);
                const t0 = process.hrtime.bigint();
                let type;
                try {
                    type = checker.getTypeAtLocation(target);
                }
                catch {
                    type = undefined;
                }
                let w = null;
                try {
                    w = type ? (0, structwalk_1.walkType)(type, checker) : null;
                }
                catch {
                    w = null;
                }
                const firstTouchMs = Number(process.hrtime.bigint() - t0) / 1e6;
                const instantiations = Math.max(0, readInstantiations(checker) - inst0);
                const typesCreated = Math.max(0, readTypeCount(checker) - created0);
                let typeStringLength = 0;
                let stringifyMs = 0;
                if (type) {
                    const ts0 = process.hrtime.bigint();
                    try {
                        typeStringLength = checker.typeToString(type).length;
                    }
                    catch {
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
                    grade: (0, metrics_1.gradeOf)({
                        properties: w?.properties ?? 0,
                        unionMembers: w?.unionMembers ?? 0,
                        depth: w?.depth ?? 0,
                        typeStringLength,
                    }),
                };
                const pushed = {
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
                if (w)
                    walkRefsPerDecl.set(pushed, w.refs);
                astRefsPerDecl.set(pushed, (0, astrefs_1.collectTypeRefs)(d.node));
            }
            done++;
            emit({ type: 'progress', done, total: projectFiles.length, file: path.basename(file) });
        }
        // phase 2: attribution join (each declaration's OWN referenced types -> measured costs)
        const byName = new Map();
        for (const r of results)
            if (!byName.has(r.name))
                byName.set(r.name, r);
        for (const r of results) {
            const walkRefs = walkRefsPerDecl.get(r);
            const astRefs = astRefsPerDecl.get(r);
            if (!walkRefs && !astRefs)
                continue;
            const merged = new Map(astRefs ?? []);
            if (walkRefs) {
                for (const [name, count] of walkRefs)
                    merged.set(name, (merged.get(name) ?? 0) + count);
            }
            const refs = merged;
            const matched = [];
            for (const [name] of refs) {
                const hit = byName.get(name);
                if (hit && hit.name !== r.name) {
                    matched.push({ name: hit.name, ms: hit.firstTouchMs, instantiations: hit.instantiations });
                }
            }
            matched.sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0));
            r.attribution = matched.slice(0, 5);
        }
        const summary = {
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
    }
    catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        process.exitCode = 1;
    }
}
main();
