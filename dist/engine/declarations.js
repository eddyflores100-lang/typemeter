"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectDeclarations = collectDeclarations;
function collectDeclarations(sourceFile, checker, T) {
    const out = [];
    const push = (node, nameNode, kind) => {
        const name = nameNode && T.isIdentifier(nameNode)
            ? nameNode.text
            : syntheticName(node, checker);
        out.push({
            node,
            nameNode,
            name,
            kind,
            line: node.getSourceFile().getLineAndCharacterOfPosition(nameNode ? nameNode.getStart() : node.getStart()).line,
            col: (nameNode ? nameNode.getStart() : node.getStart()) -
                node.getStart(),
        });
    };
    const visit = (node) => {
        const parent = node.parent;
        if (T.isTypeAliasDeclaration(node))
            push(node, node.name, 'type-alias');
        else if (T.isInterfaceDeclaration(node))
            push(node, node.name, 'interface');
        else if (T.isClassDeclaration(node))
            push(node, node.name, 'class');
        else if (T.isEnumDeclaration(node))
            push(node, node.name, 'enum');
        else if (T.isFunctionDeclaration(node) && node.name)
            push(node, node.name, 'function');
        else if ((T.isMethodDeclaration(node) || T.isMethodSignature(node)) &&
            node.name &&
            T.isIdentifier(node.name) &&
            parent &&
            (T.isInterfaceDeclaration(parent) || T.isClassDeclaration(parent) || T.isClassExpression(parent)))
            push(node, node.name, 'method');
        else if ((T.isPropertyDeclaration(node) || T.isPropertySignature(node)) &&
            node.name &&
            T.isIdentifier(node.name) &&
            parent &&
            (T.isInterfaceDeclaration(parent) || T.isClassDeclaration(parent) || T.isClassExpression(parent)))
            push(node, node.name, 'property');
        else if (T.isVariableStatement(node)) {
            const first = node.declarationList.declarations[0];
            if (first && first.type)
                push(node, first.name, 'variable');
        }
        else {
            T.forEachChild(node, visit);
            return;
        }
        // still descend into declarations with bodies/members (nested classes, vars in fns)
        T.forEachChild(node, visit);
    };
    T.forEachChild(sourceFile, visit);
    return out;
}
function syntheticName(node, _checker) {
    const sf = node.getSourceFile();
    const pos = node.getStart();
    const { line } = sf.getLineAndCharacterOfPosition(pos);
    return `(anonymous @ ${line + 1})`;
}
