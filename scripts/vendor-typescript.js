#!/usr/bin/env node
/** Vendor the TypeScript compiler into vendor/ so the packaged VSIX is self-contained. */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'typescript', 'lib');
const dst = path.join(__dirname, '..', 'vendor', 'typescript', 'lib');

fs.rmSync(path.dirname(dst), { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });

let count = 0;
for (const f of fs.readdirSync(src)) {
  if (
    f === 'typescript.js' ||
    f === 'typescript.d.ts' ||
    f === 'tsserverlibrary.js' ||
    f === 'tsserverlibrary.d.ts' ||
    /^lib\..+\.d\.ts$/.test(f)
  ) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
    count++;
  }
}
console.log(`vendored ${count} files -> vendor/typescript/lib`);
