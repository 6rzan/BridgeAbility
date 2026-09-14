'use strict';

const { z } = require('zod');




const CATEGORIES = ['transport', 'interpreter', 'caregiver', 'mobility', 'other'];



const SORT_OPTIONS = {
  relevance: { label: 'Most relevant', sql: 's.created_at DESC' },
  price_asc: { label: 'Price: low to high', sql: 's.price ASC, s.service_id ASC' },
  price_desc: { label: 'Price: high to low', sql: 's.price DESC, s.service_id ASC' },
  title: { label: 'Title A to Z', sql: 's.title ASC' },
};

const PER_PAGE = 6;


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



function escapeLikeTerm(term) {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

module.exports = { serviceSearchSchema, escapeLikeTerm, CATEGORIES, SORT_OPTIONS, PER_PAGE };
