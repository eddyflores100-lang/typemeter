#!/usr/bin/env node
/** Headless end-to-end test: run the CLI against the fixture project and assert invariants. */
const { execFile } = require('child_process');
const path = require('path');
const assert = require('assert');

const CLI = path.join(__dirname, '..', 'dist', 'cli.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'project');

execFile(process.execPath, [CLI, FIXTURE, '--json'], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
  try {
    assert.ok(!err, `CLI exited with error: ${stderr.slice(0, 400)}`);
    const summary = JSON.parse(stdout);

    // basic shape
    assert.ok(summary.declCount >= 8, `expected >= 8 declarations, got ${summary.declCount}`);
    assert.ok(summary.fileCount >= 1);
    assert.ok(summary.programMs > 0);
    assert.ok(summary.typescriptVersion && /^\d+\./.test(summary.typescriptVersion));
    assert.ok(['project', 'bundled', 'vendored'].includes(summary.typescriptSource));

    const byName = new Map(summary.results.map((r) => [r.name, r]));

    // every result has valid numeric metrics
    for (const r of summary.results) {
      assert.ok(typeof r.firstTouchMs === 'number' && r.firstTouchMs >= 0, `bad ms for ${r.name}`);
      assert.ok(Number.isInteger(r.instantiations) && r.instantiations >= 0, `bad inst for ${r.name}`);
      assert.ok(Number.isInteger(r.typesCreated) && r.typesCreated >= 0, `bad created for ${r.name}`);
      assert.ok(/^[A-E]$/.test(r.complexity.grade), `bad grade for ${r.name}`);
      assert.ok(Array.isArray(r.attribution));
    }

    // complexity expectations
    const digit = byName.get('Digit');
    assert.ok(digit, 'Digit not measured');
    assert.ok(digit.complexity.unionMembers >= 40, `Digit union members ${digit.complexity.unionMembers}`);

    const deep = byName.get('DeepChain');
    assert.ok(deep, 'DeepChain not measured');
    assert.ok(deep.complexity.depth >= 2, `DeepChain depth ${deep.complexity.depth}`);

    const userId = byName.get('UserId');
    assert.ok(userId, 'UserId not measured');
    assert.ok(userId.complexity.grade === 'A', `UserId grade ${userId.complexity.grade}`);

    // heavier machinery should cost more than the trivial alias
    const rowTable = byName.get('RowTable');
    assert.ok(rowTable, 'RowTable not measured');
    assert.ok(rowTable.instantiations > userId.instantiations, 'RowTable should instantiate more than UserId');

    // attribution: RowTable should reference RowShape/Table
    const attrNames = rowTable.attribution.map((a) => a.name);
    assert.ok(
      attrNames.some((n) => n === 'RowShape' || n === 'Table'),
      `RowTable attribution missing RowShape/Table: ${attrNames.join(',')}`
    );
    const rowShape = byName.get('RowShape');
    if (rowShape) {
      const linked = rowTable.attribution.find((a) => a.name === 'RowShape');
      assert.ok(linked && linked.ms === rowShape.firstTouchMs, 'attribution ms mismatch');
    }

    console.log(`OK — ${summary.declCount} declarations, TS ${summary.typescriptVersion} (${summary.typescriptSource})`);
    console.log(`    program ${summary.programMs.toFixed(1)} ms · total first-touch ${summary.totalMs.toFixed(1)} ms`);
    console.log('    top 3:');
    for (const r of summary.results.slice(0, 3)) {
      console.log(`      ${r.firstTouchMs.toFixed(2)} ms · ${r.instantiations} inst · ${r.name}`);
    }
    process.exit(0);
  } catch (e) {
    console.error('TEST FAILED:', e.message);
    if (stderr) console.error('stderr:', stderr.slice(0, 800));
    process.exit(1);
  }
});
