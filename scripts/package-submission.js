#!/usr/bin/env node
'use strict';

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

    shell: process.platform === 'win32',
    ...options,
  });
}

function fail(message) {
  console.error(`package-submission: ${message}`);
  process.exit(1);
}

console.log(`package-submission: packaging ${gitRef} as ${outputName}.zip`);

const status = run('git', ['status', '--porcelain']);
if (status.trim() !== '') {
  fail('working tree is not clean. Commit or stash first:\n' + status);
}
console.log('package-submission: working tree clean');

try {
  run('npm', ['test'], { stdio: 'inherit' });
} catch {
  fail('unit tests failed -- fix them before packaging.');
}
console.log('package-submission: unit tests passed');

try {
  run('bash', ['scripts/secret-scan.sh'], { stdio: 'inherit' });
} catch {
  fail('secret scan failed -- resolve before packaging.');
}
console.log('package-submission: secret scan clean');

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
