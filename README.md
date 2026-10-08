# TypeMeter

**Compiler-level TypeScript type cost: load-time, complexity and attribution — measured inside the checker, not guessed from strings.**

TypeMeter answers one question precisely: *what does each type in your project actually cost the type checker — and why?*

- **First-touch time (ms)** — wall-clock cost of resolving a declaration's type the first time a fresh checker touches it.
- **Checker instantiations** — how many type instantiations the declaration triggered, read from the compiler's own counter (`TypeChecker#getInstantiationCount()`).
- **Types created** — how many distinct types the checker had to materialise (`TypeChecker#getTypeCount()`).
- **Structural complexity** — bounded walk of the resolved type: properties, union/intersection size, nesting depth, rendered-string length → heuristic grade A–E.
- **Cost attribution** — the declaration's referenced in-project types joined with *their* measured cost, so you can see which dependency makes a type expensive.

All timing and counting comes from the TypeScript compiler API itself. There is no proxy measurement (no language-service response timing) and no string heuristics presented as timing.

## Features

| Surface | What you get |
| --- | --- |
| `TypeMeter: Measure Project Types` | fresh-process sweep of every type alias, interface, class, enum, function, method, property and typed variable |
| `TypeMeter: Measure Type at Cursor (isolated)` | re-measures fresh and reports the declaration nearest your cursor |
| `TypeMeter: Cross-check vs tsc (--generateTrace)` | runs the project's own `tsc --noEmit --extendedDiagnostics --generateTrace` and compares TypeMeter's counters and cold-start totals against the compiler's own instrumentation |
| `TypeMeter: Show Slowest Types` | leaderboard webview — ranked by first-touch ms, click to jump |
| `TypeMeter: Show Declaration Detail` | full metrics panel + cost attribution table + copy-as-JSON |
| **CodeLens** | `⚡ 5.8 ms · 11 inst · D` above every measured declaration (toggleable) |
| **Hover** | cost summary + top attribution on any measured declaration |
| **Watch on save** | optional debounced re-measure (off by default) |
| **Headless CLI** | `node dist/cli.js <project> [--json] [--top N] [--crosscheck]` — CI-friendly, same engine |

## Install

```bash
# from the release VSIX
code --install-extension typemeter-0.2.0.vsix

# or from source
git clone https://github.com/eddyflores100-lang/typemeter
cd typemeter
npm install
npm run build
code --extensionDevelopmentPath=$(pwd)
```

## Usage

1. Open a TypeScript project.
2. Run **TypeMeter: Measure Project Types**.
3. Pick a `tsconfig.json` if several exist.
4. Read the CodeLens metrics, hover any measured declaration, or open **Show Slowest Types**.

### CLI (CI)

```bash
node dist/cli.js path/to/project --json > type-costs.json
node dist/cli.js path/to/project --top 20
```

Exit code 0 on success; `--json` emits the full `RunSummary` (machine-readable, stable shape).

## Cross-check against tsc (v0.2.0)

TypeMeter validates **itself** against the compiler's own instrumentation. The cross-check mode (`--crosscheck` CLI flag or the `TypeMeter: Cross-check vs tsc (--generateTrace)` command) runs the project's own `tsc --noEmit --extendedDiagnostics --generateTrace` and compares:

- **Counter identity** — the sweep's cumulative `getInstantiationCount()` / `getTypeCount()` (the same instrumentation `--extendedDiagnostics` prints) vs tsc's whole-program totals, as a coverage share.
- **Cold-start totals** — tsc's per-file `checkSourceFile` durations (from `trace.json`) summed over project files, vs TypeMeter's first-touch + program construction.
- **OOM survival** — when tsc's full check exhausts memory, the partial trace is parsed (streamed, truncation-tolerant) and the kill is reported honestly; the TypeMeter sweep completed.

Per-file histograms come with an explicit caveat: marginal first-touch redistributes shared costs, so per-file numbers are expected to differ — **the totals and the compiler counters are the anchors**.

### Real-project results

**tsperf/tracer (TS 5.4.5, pnpm monorepo)** — 203 declarations; cross-check on a *different compiler version* than TypeMeter's own dev dependency:

```
  TypeMeter sweep 60,168 inst · 18,983 types
  full tsc run   100,887 inst · 25,872 types (sweep triggers 59.6% / 73.4% of it)
  cold-start on project files: tsc check 1,098 ms vs TypeMeter first-touch 753 ms + program 1,132 ms
  most expensive interface: Message (src/messages.ts) — 37.6 ms · 8,496 inst · 2,176 typ · grade E
```

**type-fest (TS 5.9.3, 440 files, 2,838 declarations)** — the sweep surfaced a type-level explosion that `tsc` cannot even finish checking on this machine:

```
 11,323 ms 2,555,221 inst 1,513,367 typ  E  WideTest   test-d/int-range.ts:21
  1,561 ms   516,729 inst   506,549 typ  E  Int0_998   test-d/int-closed-range.ts:17
```

The full `tsc --noEmit` check of the same tree dies with *JavaScript heap out of memory* and is SIGKILLed by the OOM killer; TypeMeter's declaration sweep completed and names the exact declaration responsible for the 11-second explosion.

### Version accuracy (correctness fix)

`SyntaxKind` enum values shift between TypeScript releases (+1 between 5.4 and 5.5). A program built with one version's compiler, walked with another version's predicates, silently matches *nothing* — a TS 5.4 project measured with mismatched instances returns **0 declarations**. All AST predicates and TypeFlags reads now run through the project's resolved TypeScript module, so version accuracy holds end-to-end (this is exactly the class of bug the tracer itself exists to hunt).

## How it works

```
VS Code extension              worker process (fresh node)
      │                              │ resolve the project's own TypeScript
      │                              │   (node_modules → bundled → vendored)
      │ spawn ─────────────────────► │ create LanguageService from tsconfig
      │                              │ collect declarations (AST walk)
      │ progress NDJSON ◄────────────│ first-touch sweep, per declaration:
      │                              │   t0  = hrtime()
      │                              │   i0  = checker.getInstantiationCount()
      │                              │   type = checker.getTypeAtLocation(name)
      │                              │   bounded structural walk (complexity + refs)
      │                              │   dt, Δinstantiations, ΔtypesCreated
      │                              │ typeToString timing
      │ summary JSON ◄───────────────│ attribution join:
      │                              │   AST type refs ∪ walk refs → measured costs
```

### Methodology notes

- **Fresh process, fresh checker.** Every run spawns a clean worker so runs are comparable and nothing pollutes the editor's language service.
- **Version-accurate.** The worker prefers the *project's own* `typescript` from `node_modules`, falling back to the extension's bundled/vendored copy.
- **Marginal (first-touch) semantics.** Declarations are resolved in file order; a declaration's cost is the delta of the *first* `getTypeAtLocation` — shared prerequisites already resolved by an earlier declaration are not double-counted. This mirrors what you feel when a file is opened or a build cold-starts.
- **Real counters.** `getInstantiationCount()`/`getTypeCount()` are the compiler's own debug counters (the same source `--extendedDiagnostics` prints), read as deltas around each declaration.
- **Bounded structural walk.** Complexity expansion is capped (depth 4, 4 000 nodes, 64 members, 32 union constituents) and skips primitives and well-known stdlib globals — `string`'s 40+ methods are not your type's complexity.
- **Attribution = AST ∪ checker refs.** Type references are collected from both the declaration's type positions (annotations, generics, heritage clauses) and the resolved structure, then joined with the measured costs of those declarations.
- **Known variance.** Wall-clock ms of the *first* declarations in a run absorb checker warm-up; compare runs of the same project, or trust the instantiation/type deltas (deterministic) as the primary signal.

## Configuration

| Key | Default | Description |
| --- | --- | --- |
| `typemeter.watchOnSave` | `false` | Re-measure automatically after saves (debounced 2 s). |
| `typemeter.codeLens` | `true` | Show per-declaration CodeLens. |
| `typemeter.topN` | `50` | Rows in the leaderboard webview. |

## Development

```bash
npm install
npm run build        # esbuild extension + tsc worker/cli + vendor TypeScript
npm test             # headless end-to-end suite against test/fixtures/project
npx @vscode/vsce package --no-dependencies   # build the .vsix
```

The test suite runs the real CLI against a fixture project and asserts: metric shape, union/depth detection, grade sanity (trivial alias = A), instantiation deltas (mapped-type machinery > trivial alias), and attribution joins (measured ms match the referenced declaration's own row).

## License

[MIT](./LICENSE) — © 2026 eddyflores100-lang
