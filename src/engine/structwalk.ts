/** Bounded structural walk of a resolved type: complexity metrics + referenced declarations.
 *
 * `T` must be the same TypeScript instance the checker comes from: TypeFlags
 * numeric values are version-specific (they gain members across releases), so
 * a static import's mask can silently mis-classify another version's types.
 */
import ts from 'typescript';

type TS = typeof ts;

export interface WalkResult {
  properties: number;
  unionMembers: number;
  intersectionMembers: number;
  depth: number;
  nodes: number;
  /** referenced named type declarations -> occurrence count */
  refs: Map<string, number>;
}

const MAX_NODES = 4000;
const MAX_DEPTH = 4;
const MAX_UNION = 32;
const MAX_PROPS = 64;
const SKIP = new Set([
  'string', 'number', 'boolean', 'any', 'unknown', 'never', 'object',
  'symbol', 'bigint', 'void', 'undefined', 'null', 'Array', 'ReadonlyArray',
  'Promise', 'Record', 'Partial', 'Required', 'Pick', 'Omit', 'Readonly',
]);

/** well-known globals whose standard members are measurement noise */
const GLOBAL_NOISE = new Set([
  'Array', 'ReadonlyArray', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Iterable', 'IterableIterator', 'Iterator', 'Generator', 'AsyncGenerator',
  'RegExp', 'Date', 'Function', 'PromiseLike', 'Record', 'Partial', 'Required',
  'Pick', 'Omit', 'Readonly', 'Exclude', 'Extract', 'NonNullable', 'ReturnType',
  'Parameters', 'Awaited', 'ConstructorParameters', 'Uppercase', 'Lowercase',
  'Capitalize', 'Uncapitalize', 'ReadonlyMap', 'ReadonlySet',
]);

/** primitives & literals — expanding their apparent members would be noise.
 * Computed per-call from the RESOLVED module `T` so flags stay version-accurate. */
function primitiveFlags(T: TS): number {
  const F = T.TypeFlags;
  return (
    F.Any | F.Unknown | F.String | F.Number | F.Boolean | F.BigInt |
    F.ESSymbol | F.Void | F.Undefined | F.Null | F.Never | F.Enum |
    F.EnumLiteral | F.StringLiteral | F.NumberLiteral | F.BooleanLiteral |
    F.UniqueESSymbol
  );
}

export function walkType(
  entry: ts.Type | undefined,
  checker: ts.TypeChecker,
  T: TS
): WalkResult {
  const PRIMITIVE = primitiveFlags(T);
  const res: WalkResult = {
    properties: 0,
    unionMembers: 0,
    intersectionMembers: 0,
    depth: 0,
    nodes: 0,
    refs: new Map(),
  };
  if (!entry) return res;
  const seen = new Set<ts.Type>();
  const countRef = (t: ts.Type) => {
    const sym = t.aliasSymbol ?? t.symbol;
    if (sym) {
      const name = sym.getName();
      if (name && !SKIP.has(name) && !name.startsWith('__')) {
        res.refs.set(name, (res.refs.get(name) ?? 0) + 1);
      }
    }
  };
  const walk = (type: ts.Type | undefined, depth: number): void => {
    if (!type || res.nodes > MAX_NODES || depth > MAX_DEPTH) return;
    if (seen.has(type)) return;
    seen.add(type);
    res.nodes++;
    res.depth = Math.max(res.depth, depth);
    countRef(type);

    if ((type.flags as number) & PRIMITIVE) return;

    // stdlib globals: count the reference, do not expand their members
    const ownName = type.symbol ? type.symbol.getName() : undefined;
    if (ownName && GLOBAL_NOISE.has(ownName)) return;

    if (type.isUnion()) {
      res.unionMembers = Math.max(
        res.unionMembers,
        type.types ? type.types.length : 0
      );
      for (const t of (type.types ?? []).slice(0, MAX_UNION)) walk(t, depth + 1);
      return;
    }
    if (type.isIntersection()) {
      res.intersectionMembers = Math.max(
        res.intersectionMembers,
        type.types ? type.types.length : 0
      );
      for (const t of (type.types ?? []).slice(0, MAX_UNION)) walk(t, depth + 1);
      return;
    }

    // type references with arguments (Map<X,Y>, Table<T,K> instantiations)
    const anyType = type as unknown as { typeArguments?: readonly ts.Type[] };
    if (Array.isArray(anyType.typeArguments)) {
      for (const t of anyType.typeArguments.slice(0, MAX_PROPS)) walk(t, depth + 1);
    }

    let props: readonly ts.Symbol[] = [];
    try {
      props = checker.getPropertiesOfType(type);
    } catch {
      props = [];
    }
    if (props.length) {
      res.properties += Math.min(props.length, MAX_PROPS);
      for (const p of props.slice(0, MAX_PROPS)) {
        let pt: ts.Type | undefined;
        try {
          pt = checker.getTypeOfSymbolAtLocation(p, p.valueDeclaration ?? ({} as ts.Node));
        } catch {
          pt = undefined;
        }
        if (pt) walk(pt, depth + 1);
      }
    }

    // index signatures / number index
    try {
      const idx =
        (type as unknown as { indexInfos?: readonly { type: ts.Type }[] }).indexInfos ?? [];
      for (const info of idx.slice(0, 8)) walk(info.type, depth + 1);
    } catch {
      /* not an object type */
    }
  };
  walk(entry, 0);
  return res;
}
