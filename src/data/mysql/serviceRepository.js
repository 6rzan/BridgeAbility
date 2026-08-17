'use strict';

const { query, queryEscaped } = require('./pool');
const { escapeLikeTerm, SORT_OPTIONS } = require('../../validation/serviceSchemas');





const VISIBLE_ONLY = "s.is_active = 1 AND p.status = 'approved'";

const LIST_COLUMNS = `
  s.service_id, s.title, s.category, s.description, s.price, s.location,
  s.image_s3_key, s.image_alt_text, s.created_at,
  p.provider_id, p.org_name
`;



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

    clauses.push("(s.title LIKE ? ESCAPE '\\\\' OR s.description LIKE ? ESCAPE '\\\\' OR p.org_name LIKE ? ESCAPE '\\\\')");
    const pattern = `%${escapeLikeTerm(criteria.q)}%`;
    params.push(pattern, pattern, pattern);
  }

  return { where: clauses.join(' AND '), params };
}



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
