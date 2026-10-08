"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectTypeRefs = collectTypeRefs;
function entityNameText(e, T) {
    return T.isQualifiedName(e) ? entityNameText(e.right, T) : e.text;
}
/**
 * Collects every type reference that appears in a type position within the
 * declaration: annotations, generics, heritage clauses (`extends`/`implements`),
 * return types, parameter types. Returns name -> occurrence count.
 */
function collectTypeRefs(root, T) {
    const refs = new Map();
    const bump = (name) => {
        if (name)
            refs.set(name, (refs.get(name) ?? 0) + 1);
    };
    const visit = (node) => {
        if (T.isTypeReferenceNode(node)) {
            bump(entityNameText(node.typeName, T));
        }
        else if (T.isExpressionWithTypeArguments(node)) {
            const e = node.expression;
            if (T.isIdentifier(e))
                bump(e.text);
        }
        else if (T.isImportTypeNode(node)) {
            // import("...").Type — attr to the qualifier if present
            if (node.qualifier)
                bump(entityNameText(node.qualifier, T));
        }
        else if (T.isTypeQueryNode(node)) {
            // typeof X
            if (T.isIdentifier(node.exprName))
                bump(node.exprName.text);
        }
        T.forEachChild(node, visit);
    };
    visit(root);
    return refs;
}
