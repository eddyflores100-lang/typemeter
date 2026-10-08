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
| `TypeMeter: Show Slowest Types` | leaderboard webview — ranked by first-touch ms, click to jump |
| `TypeMeter: Show Declaration Detail` | full metrics panel + cost attribution table + copy-as-JSON |
| **CodeLens** | `⚡ 5.8 ms · 11 inst · D` above every measured declaration (toggleable) |
| **Hover** | cost summary + top attribution on any measured declaration |
| **Watch on save** | optional debounced re-measure (off by default) |
| **Headless CLI** | `node dist/cli.js <project> [--json] [--top N]` — CI-friendly, same engine |

## Install

```bash
# from the release VSIX
code --install-extension typemeter-0.1.0.vsix

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
