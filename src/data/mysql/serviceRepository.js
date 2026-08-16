'use strict';

const { query, queryEscaped } = require('./pool');
const { escapeLikeTerm, SORT_OPTIONS } = require('../../validation/serviceSchemas');

/**
 * Data access for the public service catalogue (F1).
 *
 * THE VISIBILITY RULE, IN ONE PLACE
 *
 * A listing is public only when the service is active AND its provider has been approved by
 * an administrator. Both halves are applied here, in the WHERE clause, rather than filtered
 * out in a controller or hidden in a template. A rejected provider's listing is not merely
 * unlinked -- it is not in the result set, so no URL, query string or page number can reach
 * it. The seed data contains exactly those two cases (an inactive listing and a rejected
 * provider's listing) so the rule is provable, not asserted.
 */

// Applied to every catalogue query. Written once so the browse list, the count and the detail
// lookup cannot drift apart -- a detail page that showed what the list hid would be the bug.
const VISIBLE_ONLY = "s.is_active = 1 AND p.status = 'approved'";

const LIST_COLUMNS = `
  s.service_id, s.title, s.category, s.description, s.price, s.location,
  s.image_s3_key, s.image_alt_text, s.created_at,
  p.provider_id, p.org_name
`;

/**
 * Turn the validated filters into a WHERE fragment and its bound values.
 *
 * Every fragment below is a string literal written here; only values go into `params`. That
 * is the whole reason a dynamic filter set is safe.
 */
function buildFilters(criteria) {
  const clauses = [VISIBLE_ONLY];
  const params = [];

  if (criteria.category) {
    clauses.push('s.category = ?');
    params.push(criteria.category);
  }

  if (criteria.location) {
    clauses.push('s.location = ?');
    params.push(criteria.location);
  }

  if (criteria.maxPrice !== null && criteria.maxPrice !== undefined) {
    clauses.push('s.price <= ?');
    params.push(criteria.maxPrice);
  }

  if (criteria.q) {
    // ESCAPE '\\' makes the backslashes added by escapeLikeTerm act as escapes rather than
    // as literal characters to match.
    clauses.push("(s.title LIKE ? ESCAPE '\\\\' OR s.description LIKE ? ESCAPE '\\\\' OR p.org_name LIKE ? ESCAPE '\\\\')");
    const pattern = `%${escapeLikeTerm(criteria.q)}%`;
    params.push(pattern, pattern, pattern);
  }

  return { where: clauses.join(' AND '), params };
}

/**
 * One page of matching services.
 *
 * ORDER BY comes from SORT_OPTIONS, a map we control, because a column name cannot be a bound
 * parameter. `criteria.sort` has already been narrowed to a key of that map by zod, and the
 * fallback covers the impossible case rather than trusting it.
 */
async function searchServices(criteria, { limit, offset }) {
  const { where, params } = buildFilters(criteria);
  const orderBy = (SORT_OPTIONS[criteria.sort] || SORT_OPTIONS.relevance).sql;

  return queryEscaped(
    `SELECT ${LIST_COLUMNS}
       FROM services s
       JOIN providers p ON p.provider_id = s.provider_id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

/** Total matches, for the result count and the page links. */
async function countServices(criteria) {
  const { where, params } = buildFilters(criteria);

  const rows = await query(
    `SELECT COUNT(*) AS total
       FROM services s
       JOIN providers p ON p.provider_id = s.provider_id
      WHERE ${where}`,
    params
  );

  return rows[0].total;
}

/**
 * One listing, subject to the same visibility rule as the list.
 *
 * Returns null rather than throwing, so the controller answers 404 for "does not exist" and
 * "exists but is not public" identically. Distinguishing them would confirm the existence of
 * a withdrawn listing or an unapproved provider to anyone willing to try id numbers.
 */
async function findVisibleServiceById(serviceId) {
  const rows = await query(
    `SELECT ${LIST_COLUMNS}, s.availability_json, p.description AS provider_description, p.contact
       FROM services s
       JOIN providers p ON p.provider_id = s.provider_id
      WHERE s.service_id = ? AND ${VISIBLE_ONLY}
      LIMIT 1`,
    [serviceId]
  );

  return rows[0] || null;
}

/**
 * The locations that currently have something to show, for the filter menu.
 *
 * Derived from the visible listings rather than hardcoded, so the menu can never offer a
 * choice that returns nothing, and a new provider's town appears without a code change.
 */
async function listVisibleLocations() {
  const rows = await query(
    `SELECT DISTINCT s.location
       FROM services s
       JOIN providers p ON p.provider_id = s.provider_id
      WHERE ${VISIBLE_ONLY}
      ORDER BY s.location ASC`
  );

  return rows.map((row) => row.location);
}

module.exports = {
  searchServices,
  countServices,
  findVisibleServiceById,
  listVisibleLocations,
};
