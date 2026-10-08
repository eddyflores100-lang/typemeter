/** Collect measurable declarations from a source file, top-down.
 *
 * IMPORTANT: `T` must be the SAME TypeScript module instance the program was
 * built with. `SyntaxKind` numeric values shift between TS releases (+1 from
 * 5.4 to 5.5); AST predicates from a different instance silently match nothing
 * on older/newer trees (the exact class of bug a type-perf tracer exists to
 * hunt). The static `ts` import is used for TYPES only, never for predicates.
 */
import ts from 'typescript';
import { DeclKind } from './metrics';

export interface CollectedDecl {
  node: ts.Node;
  nameNode: ts.Node | undefined;
  name: string;
  kind: DeclKind;
  line: number;
  col: number;
}

type TS = typeof ts;

export function collectDeclarations(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  T: TS
): CollectedDecl[] {
  const out: CollectedDecl[] = [];
  const push = (node: ts.Node, nameNode: ts.Node | undefined, kind: DeclKind) => {
    const name =
      nameNode && T.isIdentifier(nameNode)
        ? (nameNode as ts.Identifier).text
        : syntheticName(node, checker);
    out.push({
      node,
      nameNode,
      name,
      kind,
      line: node.getSourceFile().getLineAndCharacterOfPosition(
        nameNode ? nameNode.getStart() : node.getStart()
      ).line,
      col:
        (nameNode ? nameNode.getStart() : node.getStart()) -
        node.getStart(),
    });
  };

  const visit = (node: ts.Node): void => {
    const parent = node.parent;
    if (T.isTypeAliasDeclaration(node)) push(node, node.name, 'type-alias');
    else if (T.isInterfaceDeclaration(node)) push(node, node.name, 'interface');
    else if (T.isClassDeclaration(node)) push(node, node.name, 'class');
    else if (T.isEnumDeclaration(node)) push(node, node.name, 'enum');
    else if (T.isFunctionDeclaration(node) && node.name) push(node, node.name, 'function');
    else if (
      (T.isMethodDeclaration(node) || T.isMethodSignature(node)) &&
      node.name &&
      T.isIdentifier(node.name) &&
      parent &&
      (T.isInterfaceDeclaration(parent) || T.isClassDeclaration(parent) || T.isClassExpression(parent))
    )
      push(node, node.name, 'method');
    else if (
      (T.isPropertyDeclaration(node) || T.isPropertySignature(node)) &&
      node.name &&
      T.isIdentifier(node.name) &&
      parent &&
      (T.isInterfaceDeclaration(parent) || T.isClassDeclaration(parent) || T.isClassExpression(parent))
    )
      push(node, node.name, 'property');
    else if (T.isVariableStatement(node)) {
      const first = node.declarationList.declarations[0];
      if (first && first.type) push(node, first.name, 'variable');
    } else {
      T.forEachChild(node, visit);
      return;
    }
    // still descend into declarations with bodies/members (nested classes, vars in fns)
    T.forEachChild(node, visit);
  };
  T.forEachChild(sourceFile, visit);
  return out;
}

function syntheticName(node: ts.Node, _checker: ts.TypeChecker): string {
  const sf = node.getSourceFile();
  const pos = node.getStart();
  const { line } = sf.getLineAndCharacterOfPosition(pos);
  return `(anonymous @ ${line + 1})`;
}
