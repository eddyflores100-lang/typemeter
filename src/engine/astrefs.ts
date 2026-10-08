/** AST-level type references of a declaration — robust attribution source. */
import ts from 'typescript';

function entityNameText(e: ts.EntityName): string {
  return ts.isQualifiedName(e) ? entityNameText(e.right) : e.text;
}

/**
 * Collects every type reference that appears in a type position within the
 * declaration: annotations, generics, heritage clauses (`extends`/`implements`),
 * return types, parameter types. Returns name -> occurrence count.
 */
export function collectTypeRefs(root: ts.Node): Map<string, number> {
  const refs = new Map<string, number>();
  const bump = (name: string) => {
    if (name) refs.set(name, (refs.get(name) ?? 0) + 1);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) {
      bump(entityNameText(node.typeName));
    } else if (ts.isExpressionWithTypeArguments(node)) {
      const e = node.expression;
      if (ts.isIdentifier(e)) bump(e.text);
    } else if (ts.isImportTypeNode(node)) {
      // import("...").Type — attr to the qualifier if present
      if (node.qualifier) bump(entityNameText(node.qualifier));
    } else if (ts.isTypeQueryNode(node)) {
      // typeof X
      if (ts.isIdentifier(node.exprName)) bump(node.exprName.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return refs;
}
