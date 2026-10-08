"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectDeclarations = collectDeclarations;
/** Collect measurable declarations from a source file, top-down. */
const typescript_1 = __importDefault(require("typescript"));
function collectDeclarations(sourceFile, checker) {
    const out = [];
    const push = (node, nameNode, kind) => {
        const name = nameNode && typescript_1.default.isIdentifier(nameNode)
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
        if (typescript_1.default.isTypeAliasDeclaration(node))
            push(node, node.name, 'type-alias');
        else if (typescript_1.default.isInterfaceDeclaration(node))
            push(node, node.name, 'interface');
        else if (typescript_1.default.isClassDeclaration(node))
            push(node, node.name, 'class');
        else if (typescript_1.default.isEnumDeclaration(node))
            push(node, node.name, 'enum');
        else if (typescript_1.default.isFunctionDeclaration(node) && node.name)
            push(node, node.name, 'function');
        else if ((typescript_1.default.isMethodDeclaration(node) || typescript_1.default.isMethodSignature(node)) &&
            node.name &&
            typescript_1.default.isIdentifier(node.name) &&
            parent &&
            (typescript_1.default.isInterfaceDeclaration(parent) || typescript_1.default.isClassDeclaration(parent) || typescript_1.default.isClassExpression(parent)))
            push(node, node.name, 'method');
        else if ((typescript_1.default.isPropertyDeclaration(node) || typescript_1.default.isPropertySignature(node)) &&
            node.name &&
            typescript_1.default.isIdentifier(node.name) &&
            parent &&
            (typescript_1.default.isInterfaceDeclaration(parent) || typescript_1.default.isClassDeclaration(parent) || typescript_1.default.isClassExpression(parent)))
            push(node, node.name, 'property');
        else if (typescript_1.default.isVariableStatement(node)) {
            const first = node.declarationList.declarations[0];
            if (first && first.type)
                push(node, first.name, 'variable');
        }
        else {
            typescript_1.default.forEachChild(node, visit);
            return;
        }
        // still descend into declarations with bodies/members (nested classes, vars in fns)
        typescript_1.default.forEachChild(node, visit);
    };
    typescript_1.default.forEachChild(sourceFile, visit);
    return out;
}
function syntheticName(node, _checker) {
    const sf = node.getSourceFile();
    const pos = node.getStart();
    const { line } = sf.getLineAndCharacterOfPosition(pos);
    return `(anonymous @ ${line + 1})`;
}
