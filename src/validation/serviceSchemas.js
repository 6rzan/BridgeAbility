'use strict';

const { z } = require('zod');

/**
 * Query validation for the service catalogue (F1).
 *
 * The catalogue reads its entire state from the query string, which is what makes a filtered
 * result shareable, bookmarkable and reachable with the browser's back button. That also means
 * every filter is attacker-controlled text, so nothing here is optional.
 */

const CATEGORIES = ['transport', 'interpreter', 'caregiver', 'mobility', 'other'];

/**
 * Sort options are a fixed map from a key to a SQL fragment written by us. The request only
 * ever chooses a key; the ORDER BY text never comes from the user, which is the one place a
 * search page usually leaks SQL because a column name cannot be a bound parameter.
 */
const SORT_OPTIONS = {
  relevance: { label: 'Most relevant', sql: 's.created_at DESC' },
  price_asc: { label: 'Price: low to high', sql: 's.price ASC, s.service_id ASC' },
  price_desc: { label: 'Price: high to low', sql: 's.price DESC, s.service_id ASC' },
  title: { label: 'Title A to Z', sql: 's.title ASC' },
};

const PER_PAGE = 6;

// An empty filter arrives as "" from a select or text input that the user cleared. Treating
// that as null keeps "no filter" and "filter for the empty string" from being confused.
const blankToNull = (value) => (typeof value === 'string' && value.trim() === '' ? null : value);

const serviceSearchSchema = z.object({
  q: z.preprocess(
    blankToNull,
    z.string().trim().max(120, 'Use 120 characters or fewer.').nullable().default(null)
  ),

  category: z.preprocess(
    blankToNull,
    z.enum(CATEGORIES).nullable().default(null)
  ),

  location: z.preprocess(
    blankToNull,
    z.string().trim().max(120).nullable().default(null)
  ),

  // Coerced from the query string, which is always text. Negative and absurd values are
  // rejected rather than clamped, so a broken link is visibly broken.
  maxPrice: z.preprocess(
    blankToNull,
    z.coerce.number().positive('Enter a price greater than zero.').max(100000).nullable().default(null)
  ),

  sort: z.preprocess(
    blankToNull,
    z.enum(Object.keys(SORT_OPTIONS)).nullable().default(null)
  ).transform((value) => value || 'relevance'),

  page: z.preprocess(
    blankToNull,
    z.coerce.number().int().min(1).max(1000).nullable().default(null)
  ).transform((value) => value || 1),
});

/**
 * Escape the LIKE wildcards in a user's search term.
 *
 * Without this, searching for "100%" matches everything, and a term of many "%_" pairs makes
 * the server do far more pattern work than the user asked for. The value is still bound as a
 * parameter -- this is about the pattern language inside the string, not about SQL injection.
 */
function escapeLikeTerm(term) {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

module.exports = { serviceSearchSchema, escapeLikeTerm, CATEGORIES, SORT_OPTIONS, PER_PAGE };
