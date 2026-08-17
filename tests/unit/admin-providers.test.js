'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROVIDER_STATUSES,
  PROVIDER_STATUS_LABELS,
  adminProviderListSchema,
} = require('../../src/validation/adminProviderSchemas');
const { decorate } = require('../../src/services/adminProviderService');
const {
  parseProviderId,
  buildQueryString,
} = require('../../src/controllers/adminProviderController');
const { buildPlaceholderPdf } = require('../../db/seed-media');



test('each of the three registration statuses is accepted as a filter', () => {
  for (const status of PROVIDER_STATUSES) {
    const parsed = adminProviderListSchema.safeParse({ status });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.status, status);
  }
});

test('a status outside the three is rejected, not silently ignored', () => {
  const parsed = adminProviderListSchema.safeParse({ status: 'approved-ish' });
  assert.equal(parsed.success, false);
});

test('a blank filter is treated as absent, not as a value to match', () => {
  const parsed = adminProviderListSchema.safeParse({ status: '' });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.status, null);
});



test('every provider status has a label', () => {
  for (const status of PROVIDER_STATUSES) {
    assert.ok(PROVIDER_STATUS_LABELS[status], `missing a label for "${status}"`);
  }
});



test('only a pending registration can be decided', () => {
  const base = { provider_id: 1, status: 'pending', created_at: new Date('2026-07-01T00:00:00Z') };

  assert.equal(decorate(base).canDecide, true);
  assert.equal(decorate({ ...base, status: 'approved' }).canDecide, false);
  assert.equal(decorate({ ...base, status: 'rejected' }).canDecide, false);
});

test('a registration with no review yet has no reviewed label', () => {
  const decorated = decorate({
    provider_id: 1,
    status: 'pending',
    created_at: new Date('2026-07-01T00:00:00Z'),
    reviewed_at: null,
  });

  assert.equal(decorated.reviewedLabel, null);
});

test('a reviewed registration formats the review date on the Malaysian clock', () => {
  const decorated = decorate({
    provider_id: 1,
    status: 'approved',
    created_at: new Date('2026-07-01T00:00:00Z'),
    reviewed_at: new Date('2026-07-02T06:45:00Z'),
  });

  assert.match(decorated.reviewedLabel, /14:45/);
});



test('a positive integer string is a valid provider id', () => {
  assert.equal(parseProviderId('4'), 4);
});

test('anything that is not a positive integer is not a provider id', () => {
  assert.equal(parseProviderId('0'), null);
  assert.equal(parseProviderId('-1'), null);
  assert.equal(parseProviderId('abc'), null);
});

test('the query string carries only the filters actually in force', () => {
  assert.equal(buildQueryString(null), '');
  assert.equal(buildQueryString('pending'), '?status=pending');
  assert.equal(buildQueryString('pending', { page: 2 }), '?status=pending&page=2');
});



test('the seeded verification document is a structurally valid PDF', () => {
  const pdf = buildPlaceholderPdf(['Placeholder verification document', 'Example Org']);
  const text = pdf.toString('latin1');

  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /%%EOF$/);

  const xrefOffset = Number(text.match(/startxref\n(\d+)\n%%EOF$/)[1]);
  assert.equal(text.slice(xrefOffset, xrefOffset + 4), 'xref');

  const objectOffsets = [...text.matchAll(/(\d{10}) 00000 n /g)].map((match) => Number(match[1]));
  assert.equal(objectOffsets.length, 5);

  objectOffsets.forEach((offset, index) => {
    assert.equal(
      text.slice(offset, offset + `${index + 1} 0 obj`.length),
      `${index + 1} 0 obj`
    );
  });
});
