# TSPerf Challenge Submission: TypeMeter

**TypeMeter** — an MIT-licensed VS Code plugin that shows the **complexity / time to load of a TypeScript type**, measured inside the compiler, with **cost attribution** (which referenced declarations make a type expensive).

- **Source (MIT):** https://github.com/eddyflores100-lang/typemeter
- **Installable VSIX release:** (attached to the GitHub release of the repo above)
- **Live demo output on a fixture project is below.**

> Note: PRs/issues on `algora-io/algora` are restricted to prior contributors, so — following the same route as the other submission in this repo — the submission is filed here at the challenge-referenced repository.

## What it shows

For every type alias, interface, class, enum, function, method, property and typed variable in the project:

| Metric | Source |
| --- | --- |
| **first-touch time (ms)** | wall-clock of the first `getTypeAtLocation()` in a fresh checker, plus a bounded structural load |
| **checker instantiations** | `TypeChecker#getInstantiationCount()` delta — the compiler's own counter |
| **types created** | `TypeChecker#getTypeCount()` delta |
| **complexity (grade A–E + raw)** | bounded structural walk: properties, union/intersection size, nesting depth, `typeToString` length and stringify time |
| **cost attribution** | the declaration's referenced in-project types joined with *their own* measured cost |

## Surfaces

- `TypeMeter: Measure Project Types` — fresh-process sweep, progress streaming, cancellable
- `TypeMeter: Measure Type at Cursor (isolated)` — re-measures fresh, nearest declaration to the cursor
- `TypeMeter: Show Slowest Types` — leaderboard webview, click-to-jump
- `TypeMeter: Show Declaration Detail` — full metrics + attribution table + copy-as-JSON
- **CodeLens** on every measured declaration: `⚡ 5.8 ms · 11 inst · D`
- **Hover** on measured declarations: cost summary + top attribution
- Optional **watch-on-save** re-measurement (debounced, off by default)
- **Headless CLI** for CI: `node dist/cli.js <project> --json`

## Accuracy methodology

- Runs in a **fresh worker process** per measurement → comparable runs, zero pollution of the editor's language service.
- Uses the **project's own TypeScript** from `node_modules` (falls back to bundled/vendored) → version-accurate results.
- Real compiler counters (`getInstantiationCount()` / `getTypeCount()`), the same source `--extendedDiagnostics` prints — **no proxy timing, no string heuristics presented as timing**.
- **Marginal first-touch semantics**: declarations resolved in order; shared prerequisites already resolved by an earlier declaration are not double-counted — the cost you feel when a file is opened or a build cold-starts.
- Bounded structural walk (depth 4 / 4 000 nodes / 64 members / 32 union constituents) with **stdlib noise guards** — `string`'s 40+ methods and `Array`'s members are not your type's complexity.
- Attribution merges **AST type references** (annotations, generics, heritage clauses) with **checker-walk references**, joined to the measured costs of those declarations.

## Demo (fixture project, TS 5.9.3)

```
TypeMeter — TypeScript type cost report
  TS 5.9.3 (bundled) · 1 files · 21 declarations
  program: 677.6 ms · total first-touch: 15.9 ms

         ms         inst       types  grade  name
     5.80 ms      11 inst      69 typ D  EventName   (template-literal + Capitalize machinery)
     1.72 ms       0 inst       1 typ B  Simple
     1.59 ms       6 inst       8 typ B  RowShape
     1.28 ms       3 inst      15 typ B  RowEvents   → attribution: RowShape (1.59 ms), EventName (5.80 ms)
     1.26 ms       0 inst       6 typ A  Table
     1.12 ms       0 inst       0 typ A  UserId
     0.78 ms       4 inst      11 typ B  RowTable   (mapped-type instantiation)
     0.72 ms       0 inst      80 typ C  Digit      (40-literal union)
```

The headless test suite asserts: metric shape, union/depth detection, grade sanity (trivial alias = A, 40-literal union = C), instantiation deltas (mapped-type machinery > trivial alias), and attribution joins (the referenced declaration's ms in a row equals its own measured row).

## Requirements checklist

- ✅ VS Code plugin
- ✅ Shows the complexity of a TypeScript type (grade + raw structural metrics)
- ✅ Shows the time to load of a TypeScript type (first-touch ms, compiler counters)
- ✅ MIT licensed, open sourced
- ✅ Installable VSIX release
- ✅ Documented methodology
