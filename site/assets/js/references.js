/**
 * Expands the `[[key]]` markers pages write in place of citations into links
 * carrying the full bibliographic record.
 *
 * Two bibliographies feed the registry: the SITE one, embedded by the build in
 * `<script id="siteReferences">` from src/template/references.js, and a PAGE one
 * registered at runtime by whoever loads their own data (climatologia.js does
 * it with the bibliography the exporter's manifest carries).
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
   * A PAGE bibliography arrives with the deploy data, outside every lint and
   * build gate, and `url` is the one field the browser interprets. An odd scheme
   * does not void the entry: the citation stays legible, just not clickable.
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
    // An unregistered marker stays literal, so a broken citation is visible in
    // review instead of vanishing and leaving the sentence citing nothing.
    if (!entry) return document.createTextNode(`[[${key}]]`);
    // Without a usable URL it renders as text; `.site-ref` styles both the same.
    const linked = linkable(entry.url);
    const element = document.createElement(linked ? "a" : "span");
    element.className = "site-ref";
    // Keeps the key on the expanded citation so a page can list what it actually cited without repeating the key
    // list in its own JS — two copies of that list drift the day someone edits only the prose.
    element.dataset.refKey = key;
    if (linked) {
      element.href = entry.url;
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    }
    element.title = entry.citation;
    element.textContent = entry.short;
    element.setAttribute("aria-label", `${entry.short}. ${entry.citation}`);
    return element;
  }

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
      return entry ? entry.short : marker;
    });
  }

  function keysIn(text) {
    return [...new Set([...String(text).matchAll(MARKER)].map((match) => match[1]))];
  }

  function get(key) {
    return registry.get(key) || null;
  }

  // Walks TEXT nodes, never `innerHTML`: rewriting markup to insert a link would
  // open an injection path the day one of these sentences comes from data.
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
        // An unreadable bibliography leaves the markers literal; the page stands.
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
