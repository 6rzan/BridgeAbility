'use strict';

/**
 * WCAG 2.2 relative-luminance contrast checker for the BridgeAbility palette.
 *
 * Algorithm from the W3C WCAG 2.2 definition of relative luminance and contrast ratio:
 * https://www.w3.org/TR/WCAG22/#dfn-relative-luminance  (accessed 2026-08-16)
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio      (accessed 2026-08-16)
 *
 * Run: node scripts/check-contrast.js
 * Exits non-zero if any declared pair fails its target, so it can gate a build.
 */

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = '#ffffff';
const SURFACE = '#f4f7f8';

// [label, foreground, background, minimum required ratio]
const pairs = [
  ['body text on page',          '#12212b', WHITE,     4.5],
  ['body text on surface',       '#12212b', SURFACE,   4.5],
  ['muted text on page',         '#4c5c68', WHITE,     4.5],
  ['muted text on surface',      '#4c5c68', SURFACE,   4.5],
  ['link / primary on page',     '#0b5d6b', WHITE,     4.5],
  ['white on primary button',    WHITE,     '#0b5d6b', 4.5],
  ['white on primary hover',     WHITE,     '#084651', 4.5],
  ['danger text on page',        '#a0201c', WHITE,     4.5],
  ['white on danger button',     WHITE,     '#a0201c', 4.5],
  ['success text on page',       '#1b5e20', WHITE,     4.5],
  ['warning text on page',       '#8a4b08', WHITE,     4.5],
  // Non-text contrast (WCAG 2.2 SC 1.4.11) needs 3:1, not 4.5:1.
  ['border on page',             '#7a8e99', WHITE,     3.0],
  ['border on surface',          '#7a8e99', SURFACE,   3.0],
  // The focus indicator is a dual ring: a white inner band separates it from a coloured
  // control, and an ink outer band carries the contrast against the page behind it.
  ['focus inner vs primary btn', WHITE,     '#0b5d6b', 3.0],
  ['focus inner vs danger btn',  WHITE,     '#a0201c', 3.0],
  ['focus outer vs page',        '#12212b', WHITE,     3.0],
  ['focus outer vs surface',     '#12212b', SURFACE,   3.0],
];

let failures = 0;
console.log('WCAG 2.2 contrast check — BridgeAbility palette\n');
console.log('pair                          fg        bg        ratio    need   result');
console.log('-'.repeat(74));

for (const [label, fg, bg, need] of pairs) {
  const value = ratio(fg, bg);
  const pass = value >= need;
  if (!pass) failures += 1;
  console.log(
    `${label.padEnd(29)} ${fg.padEnd(9)} ${bg.padEnd(9)} ${value.toFixed(2).padStart(6)}   ${need.toFixed(1)}    ${pass ? 'PASS' : 'FAIL'}`
  );
}

console.log('-'.repeat(74));
console.log(failures === 0 ? `All ${pairs.length} pairs pass.` : `${failures} of ${pairs.length} pairs FAIL.`);
process.exit(failures === 0 ? 0 : 1);
