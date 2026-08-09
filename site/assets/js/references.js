/**
 * REFERENCES
 *
 * Expands the `[[key]]` markers pages write in place of citations, swapping
 * each one for a link carrying the full bibliographic record in its tooltip.
 *
 * Why a marker instead of the finished text: a hand-written citation shows up
 * in two spellings by the third time someone repeats it, and neither of them
 * leads anywhere. With a marker there is a single record, the build rejects a
 * key that does not exist, and the reader who wants to dig has somewhere to go.
 *
 * Two bibliography sources, deliberately:
 *
 * - the SITE one, embedded by the build in `<script id="siteReferences">` — the
 *   model, the physics schemes, the constants. Versioned in
 *   src/template/references.js.
 * - a PAGE one, registered at runtime by whoever loads their own data. The
 *   climatology page does this with the bibliography carried by the manifest
 *   the exporter publishes, because the distribution families are the data
 *   producer's choice and not the site's.
 *
 * Every page loads this file and it depends on nothing.
 */

"use strict";

(function () {
  const MARKER = /\[\[([a-z0-9_]+)\]\]/g;
  const registry = new Map();

  function register(entries) {
    if (!entries) return;
    for (const [key, entry] of Object.entries(entries)) {
      if (entry && entry.short && entry.citation) registry.set(key, entry);
    }
  }

  /**
   * Only http(s) becomes a link.
   *
   * A PAGE bibliography comes from the manifest the exporter publishes — a data
   * file that reaches the server through the deploy, outside the repository and
   * outside every lint and build gate. `short` and `citation` are text and can
   * only be read; `url` is the one part the browser interprets, so it is the
   * one part whose scheme must be checked. A missing or odd-scheme URL does not
   * invalidate the entry: the citation stays legible, it just is not clickable.
   */
  function linkable(url) {
    if (typeof url !== "string") return false;
    try {
      const parsed = new URL(url, document.baseURI);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  }

  function citationNode(key) {
    const entry = registry.get(key);
    // An unregistered marker stays literal on purpose: it is visible in review
    // and in testing, instead of vanishing and leaving the sentence citing
    // nothing.
    if (!entry) return document.createTextNode(`[[${key}]]`);
    // With no usable URL the citation renders as text: an <a href="undefined">
    // would only take the reader to a 404. `.site-ref` styles both the same.
    const linked = linkable(entry.url);
    const element = document.createElement(linked ? "a" : "span");
    element.className = "site-ref";
    if (linked) {
      element.href = entry.url;
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    }
    // `title` is the native tooltip: no positioning to maintain, it works in
    // every browser and it travels with the link to the screen reader.
    element.title = entry.citation;
    element.textContent = entry.short;
    element.setAttribute("aria-label", `${entry.short}. ${entry.citation}`);
    return element;
  }

  /** Marker text -> fragment with the citation links in their place. */
  function expand(text) {
    const source = String(text);
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of source.matchAll(MARKER)) {
      if (match.index > cursor) {
        fragment.appendChild(document.createTextNode(source.slice(cursor, match.index)));
      }
      fragment.appendChild(citationNode(match[1]));
      cursor = match.index + match[0].length;
    }
    if (cursor < source.length) fragment.appendChild(document.createTextNode(source.slice(cursor)));
    return fragment;
  }

  /** Same expansion in plain text, for places where markup does not fit. */
  function plain(text) {
    return String(text).replace(MARKER, (marker, key) => {
      const entry = registry.get(key);
      // An unregistered marker comes out whole, as in `citationNode()`:
      // returning the bare slug would disguise it as an ordinary word in a
      // chart legend, and nobody would see that the citation found no source.
      return entry ? entry.short : marker;
    });
  }

  function keysIn(text) {
    return [...new Set([...String(text).matchAll(MARKER)].map((match) => match[1]))];
  }

  function get(key) {
    return registry.get(key) || null;
  }

  /**
   * Swaps the markers of already-rendered static HTML.
   *
   * Walks TEXT nodes, never `innerHTML`: the content comes from the template,
   * but rewriting markup to insert a link would open the door to injection the
   * day one of those sentences starts coming from data.
   */
  function decorate(root) {
    const scope = root || document.body;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const pending = [];
    for (let current = walker.nextNode(); current; current = walker.nextNode()) {
      if (current.nodeValue && current.nodeValue.includes("[[")) pending.push(current);
    }
    for (const textNode of pending) {
      const replacement = expand(textNode.nodeValue);
      if (replacement.childNodes.length) textNode.replaceWith(replacement);
    }
    return pending.length;
  }

  function boot() {
    const embedded = document.getElementById("siteReferences");
    if (embedded) {
      try {
        register(JSON.parse(embedded.textContent));
      } catch {
        // An unreadable bibliography must not take the page down: the markers
        // stay literal and the rest of the content stands.
      }
    }
    decorate(document.body);
  }

  window.labmimReferences = { register, expand, plain, keysIn, get, decorate, linkable };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
