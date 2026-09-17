'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { asset } = require('../../src/lib/assetVersion');

const PUBLIC_ROOT = path.join(__dirname, '..', '..', 'src', 'public');

function hashOf(relativePath) {
  const contents = fs.readFileSync(path.join(PUBLIC_ROOT, relativePath));
  return crypto.createHash('sha256').update(contents).digest('hex').slice(0, 10);
}

test('the URL carries a hash of the file that is actually on disk', () => {
  assert.equal(asset('/css/main.css'), `/css/main.css?v=${hashOf('css/main.css')}`);
  assert.equal(asset('/js/a11y.js'), `/js/a11y.js?v=${hashOf('js/a11y.js')}`);
});

test('two different files get two different hashes', () => {
  assert.notEqual(asset('/css/main.css'), asset('/js/a11y.js'));
});

test('the same path yields the same URL every time', () => {
  assert.equal(asset('/js/form-validate.js'), asset('/js/form-validate.js'));
});

test('a missing asset falls back to the plain path', () => {
  assert.equal(asset('/css/does-not-exist.css'), '/css/does-not-exist.css');
});

test('a traversal attempt reads nothing and returns the path unchanged', () => {
  assert.equal(asset('/../config/index.js'), '/../config/index.js');
  assert.equal(asset('/../../package.json'), '/../../package.json');
});
