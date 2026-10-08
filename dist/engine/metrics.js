"use strict";
/** Shared result types for TypeMeter (used by worker, CLI and extension). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.gradeOf = gradeOf;
function gradeOf(c) {
    const score = c.properties / 4 + c.unionMembers / 8 + c.depth * 1.5 + c.typeStringLength / 120;
    if (score < 1)
        return 'A';
    if (score < 4)
        return 'B';
    if (score < 10)
        return 'C';
    if (score < 25)
        return 'D';
    return 'E';
}
