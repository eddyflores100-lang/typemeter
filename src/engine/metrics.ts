/** Shared result types for TypeMeter (used by worker, CLI and extension). */

export interface DeclKey {
  /** absolute file path */
  file: string;
  /** 0-based line of the declaration name */
  line: number;
  /** 1-based character of the name start */
  col: number;
  name: string;
  kind: DeclKind;
}

export type DeclKind =
  | 'type-alias'
  | 'interface'
  | 'class'
  | 'enum'
  | 'function'
  | 'method'
  | 'property'
  | 'variable';

export interface Complexity {
  /** distinct named members visible on the type (bounded walk) */
  properties: number;
  /** union constituents found (max across the structure) */
  unionMembers: number;
  /** intersection constituents found */
  intersectionMembers: number;
  /** structural nesting depth reached (bounded at 4) */
  depth: number;
  /** length of checker.typeToString() output (0 if skipped) */
  typeStringLength: number;
  /** ms spent inside typeToString — a cost signal of its own */
  stringifyMs: number;
  /** heuristic grade A..E */
  grade: string;
}

export interface RefCost {
  name: string;
  /** measured first-touch ms of the referenced declaration, if known */
  ms: number | null;
  instantiations: number | null;
}

export interface DeclResult extends DeclKey {
  /** wall-clock ms of the first getTypeAtLocation + bounded structural load */
  firstTouchMs: number;
  /** delta of the compiler's own instantiation counter */
  instantiations: number;
  /** delta of the compiler's own type-creation counter */
  typesCreated: number;
  complexity: Complexity;
  /** top referenced type declarations with their measured cost */
  attribution: RefCost[];
}

export interface RunSummary {
  projectDir: string;
  tsconfig: string;
  typescriptVersion: string;
  /** 'project' | 'bundled' */
  typescriptSource: string;
  fileCount: number;
  declCount: number;
  /** total first-touch ms across all declarations */
  totalMs: number;
  programMs: number;
  /** cumulative checker instantiation counter AFTER the whole sweep (cross-check anchor) */
  finalInstantiations: number;
  /** cumulative checker type-creation counter AFTER the whole sweep (cross-check anchor) */
  finalTypes: number;
  results: DeclResult[];
  /** present when the run included a tsc cross-check (CLI --crosscheck / extension command) */
  crossCheck?: unknown;
}

export interface ProgressLine {
  type: 'progress';
  done: number;
  total: number;
  file: string;
}

export type WorkerLine = ProgressLine | { type: 'summary'; summary: RunSummary } | { type: 'error'; message: string };

export function gradeOf(c: {
  properties: number;
  unionMembers: number;
  depth: number;
  typeStringLength: number;
}): string {
  const score =
    c.properties / 4 + c.unionMembers / 8 + c.depth * 1.5 + c.typeStringLength / 120;
  if (score < 1) return 'A';
  if (score < 4) return 'B';
  if (score < 10) return 'C';
  if (score < 25) return 'D';
  return 'E';
}
