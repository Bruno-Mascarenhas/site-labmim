"use strict";

const GLYPH_RULE_PATTERN = String.raw`((?:\.fa-[a-z0-9-]+:before,?)+)\{content:"\\([0-9a-f]+)"\}`;
const GLYPH_RULE = new RegExp(`^${GLYPH_RULE_PATTERN}$`);

const FONT_AWESOME_CLASS = /^fa(?:[srbl]?$|-)/;
const I_TAG = /<i\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const CLASS_ATTRIBUTE = /(?<![\w-])class\s*=\s*(?:"([^"]*)"|'([^']*)')/;

function glyphCodepoints(css) {
  const codepoints = new Map();
  for (const match of css.matchAll(new RegExp(GLYPH_RULE_PATTERN, "g"))) {
    for (const name of match[1].matchAll(/\.(fa-[a-z0-9-]+):before/g)) codepoints.set(name[1], match[2]);
  }
  return codepoints;
}

function manifestDisagreements(manifest, codepoints) {
  return Object.entries(manifest.glyphs)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .filter(([name, code]) => codepoints.get(name) !== code.toLowerCase())
    .map(([name, code]) => ({ name, declared: code, found: codepoints.get(name) }));
}

function hasFontAwesomeClass(tagAttributes) {
  const classAttribute = tagAttributes.match(CLASS_ATTRIBUTE);
  const classes = (classAttribute?.[1] ?? classAttribute?.[2] ?? "").split(/\s+/);
  return classes.some((name) => FONT_AWESOME_CLASS.test(name));
}

module.exports = { GLYPH_RULE, I_TAG, glyphCodepoints, hasFontAwesomeClass, manifestDisagreements };
