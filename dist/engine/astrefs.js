"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectTypeRefs = collectTypeRefs;
/** AST-level type references of a declaration — robust attribution source. */
const typescript_1 = __importDefault(require("typescript"));
function entityNameText(e) {
    return typescript_1.default.isQualifiedName(e) ? entityNameText(e.right) : e.text;
}
/**
 * Collects every type reference that appears in a type position within the
 * declaration: annotations, generics, heritage clauses (`extends`/`implements`),
 * return types, parameter types. Returns name -> occurrence count.
 */
function collectTypeRefs(root) {
    const refs = new Map();
    const bump = (name) => {
        if (name)
            refs.set(name, (refs.get(name) ?? 0) + 1);
    };
    const visit = (node) => {
        if (typescript_1.default.isTypeReferenceNode(node)) {
            bump(entityNameText(node.typeName));
        }
        else if (typescript_1.default.isExpressionWithTypeArguments(node)) {
            const e = node.expression;
            if (typescript_1.default.isIdentifier(e))
                bump(e.text);
        }
        else if (typescript_1.default.isImportTypeNode(node)) {
            // import("...").Type — attr to the qualifier if present
            if (node.qualifier)
                bump(entityNameText(node.qualifier));
        }
        else if (typescript_1.default.isTypeQueryNode(node)) {
            // typeof X
            if (typescript_1.default.isIdentifier(node.exprName))
                bump(node.exprName.text);
        }
        typescript_1.default.forEachChild(node, visit);
    };
    visit(root);
    return refs;
}
