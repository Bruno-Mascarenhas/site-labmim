"use strict";

const GLYPH_RULE_PATTERN = String.raw`((?:\.fa-[a-z0-9-]+:before,?)+)\{content:"\\([0-9a-f]+)"\}`;
const GLYPH_RULE = new RegExp(`^${GLYPH_RULE_PATTERN}$`);

function glyphCodepoints(css) {
  const codepoints = new Map();
  for (const match of css.matchAll(new RegExp(GLYPH_RULE_PATTERN, "g"))) {
    for (const name of match[1].matchAll(/\.(fa-[a-z0-9-]+):before/g)) codepoints.set(name[1], match[2]);
  }
  return codepoints;
}

module.exports = { GLYPH_RULE, glyphCodepoints };
