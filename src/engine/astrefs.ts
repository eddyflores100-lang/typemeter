/** AST-level type references of a declaration — robust attribution source.
 *
 * `T` must be the same TypeScript instance that produced the AST (see
 * declarations.ts for why SyntaxKind predicates must match the program's
 * compiler instance).
 */
import ts from 'typescript';

type TS = typeof ts;

function entityNameText(e: ts.EntityName, T: TS): string {
  return T.isQualifiedName(e) ? entityNameText((e as ts.QualifiedName).right, T) : (e as ts.Identifier).text;
}

/**
 * Collects every type reference that appears in a type position within the
 * declaration: annotations, generics, heritage clauses (`extends`/`implements`),
 * return types, parameter types. Returns name -> occurrence count.
 */
export function collectTypeRefs(root: ts.Node, T: TS): Map<string, number> {
  const refs = new Map<string, number>();
  const bump = (name: string) => {
    if (name) refs.set(name, (refs.get(name) ?? 0) + 1);
  };
  const visit = (node: ts.Node): void => {
    if (T.isTypeReferenceNode(node)) {
      bump(entityNameText(node.typeName, T));
    } else if (T.isExpressionWithTypeArguments(node)) {
      const e = node.expression;
      if (T.isIdentifier(e)) bump(e.text);
    } else if (T.isImportTypeNode(node)) {
      // import("...").Type — attr to the qualifier if present
      if (node.qualifier) bump(entityNameText(node.qualifier, T));
    } else if (T.isTypeQueryNode(node)) {
      // typeof X
      if (T.isIdentifier(node.exprName)) bump(node.exprName.text);
    }
    T.forEachChild(node, visit);
  };
  visit(root);
  return refs;
}
