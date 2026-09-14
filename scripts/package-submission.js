#!/usr/bin/env node
'use strict';

/**
 * Builds the submission zip from `git archive`, never from a manually picked folder list.
 *
 * WHY THIS EXISTS
 *
 * A prior submission zip for this project contained only src/ and db/ -- no package.json, no
 * tests, no docs/crud-matrix.md, no README, no deployment config -- because it was built by
 * hand-selecting folders rather than from what git actually tracks. `git archive` cannot make
 * that mistake: it zips exactly the committed tree at a given ref, which is by construction
 * everything that is supposed to be in the submission and nothing that is gitignored (no
 * node_modules, no .env, no .elasticbeanstalk state).
 *
 * Usage:
 *   node scripts/package-submission.js [output-name] [git-ref]
 *
 *   output-name  defaults to "G21_Task_2_Final_System" -- no .zip suffix, no spaces (the Task 1
 *                zip's own name had a space in it, which is needless friction on every OS).
 *   git-ref      defaults to HEAD.
 *
 * Refuses to run against a dirty working tree, a repo that fails its own secret scan, or a
 * repo whose unit tests are red -- a broken or leaking submission is a worse outcome than a
 * late one, and every check here is fast.
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const repoRoot = path.resolve(__dirname, '..');
const outputName = process.argv[2] || 'G21_Task_2_Final_System';
const gitRef = process.argv[3] || 'HEAD';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...options,
  });
}

function fail(message) {
  console.error(`package-submission: ${message}`);
  process.exit(1);
}

console.log(`package-submission: packaging ${gitRef} as ${outputName}.zip`);

// 1. Refuse a dirty working tree -- a zip must reflect a real, inspectable commit, not
//    whatever happens to be on disk this minute.
const status = run('git', ['status', '--porcelain']);
if (status.trim() !== '') {
  fail('working tree is not clean. Commit or stash first:\n' + status);
}
console.log('package-submission: working tree clean');

// 2. Unit tests must be green. This is the suite that runs without AWS credentials, so there
//    is no excuse for it to be red at packaging time.
try {
  run('npm', ['test'], { stdio: 'inherit' });
} catch {
  fail('unit tests failed -- fix them before packaging.');
}
console.log('package-submission: unit tests passed');

// 3. The secret scan gates every push per CLAUDE.md; it gates the submission zip too.
try {
  run('bash', ['scripts/secret-scan.sh'], { stdio: 'inherit' });
} catch {
  fail('secret scan failed -- resolve before packaging.');
}
console.log('package-submission: secret scan clean');

// 4. Build the zip from exactly what git tracks at gitRef.
const outputPath = path.join(repoRoot, `${outputName}.zip`);
if (fs.existsSync(outputPath)) {
  fs.unlinkSync(outputPath);
}

run('git', [
  'archive',
  '--format=zip',
  `--prefix=${outputName}/`,
  '-o', outputPath,
  gitRef,
]);

const fileCount = run('git', ['ls-tree', '-r', '--name-only', gitRef]).trim().split('\n').length;
const { size } = fs.statSync(outputPath);

console.log(`package-submission: wrote ${path.relative(repoRoot, outputPath)}`);
console.log(`package-submission: ${fileCount} files, ${(size / 1024).toFixed(0)} KB`);
console.log('package-submission: verify it contains package.json, tests/, docs/ and README.md before submitting.');
