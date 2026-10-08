/** Collect measurable declarations from a source file, top-down. */
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

export function collectDeclarations(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): CollectedDecl[] {
  const out: CollectedDecl[] = [];
  const push = (node: ts.Node, nameNode: ts.Node | undefined, kind: DeclKind) => {
    const name =
      nameNode && ts.isIdentifier(nameNode)
        ? nameNode.text
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
    if (ts.isTypeAliasDeclaration(node)) push(node, node.name, 'type-alias');
    else if (ts.isInterfaceDeclaration(node)) push(node, node.name, 'interface');
    else if (ts.isClassDeclaration(node)) push(node, node.name, 'class');
    else if (ts.isEnumDeclaration(node)) push(node, node.name, 'enum');
    else if (ts.isFunctionDeclaration(node) && node.name) push(node, node.name, 'function');
    else if (
      (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      parent &&
      (ts.isInterfaceDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent))
    )
      push(node, node.name, 'method');
    else if (
      (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      parent &&
      (ts.isInterfaceDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent))
    )
      push(node, node.name, 'property');
    else if (ts.isVariableStatement(node)) {
      const first = node.declarationList.declarations[0];
      if (first && first.type) push(node, first.name, 'variable');
    } else {
      ts.forEachChild(node, visit);
      return;
    }
    // still descend into declarations with bodies/members (nested classes, vars in fns)
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return out;
}

function syntheticName(node: ts.Node, _checker: ts.TypeChecker): string {
  const sf = node.getSourceFile();
  const pos = node.getStart();
  const { line } = sf.getLineAndCharacterOfPosition(pos);
  return `(anonymous @ ${line + 1})`;
}
