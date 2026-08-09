/**
 * REFERÊNCIAS
 *
 * Expande os marcadores `[[chave]]` que as páginas escrevem no lugar das
 * citações, trocando cada um por um link com o registro bibliográfico completo
 * no tooltip.
 *
 * Por que marcador e não o texto pronto: uma citação escrita à mão aparece em
 * duas grafias na terceira vez que alguém a repete, e nenhuma delas leva a lugar
 * nenhum. Com marcador existe um registro só, o build recusa uma chave que não
 * existe, e o leitor que quiser aprender tem para onde ir.
 *
 * Duas fontes de bibliografia, deliberadamente:
 *
 * - a do SITE, embutida pelo build em `<script id="siteReferences">` — o modelo,
 *   os esquemas de física, as constantes. É versionada em src/template/references.js.
 * - a de uma PÁGINA, registrada em runtime por quem carrega dados próprios. A
 *   climatologia faz isso com a bibliografia que vem no manifesto publicado pelo
 *   exportador, porque as famílias de distribuição são escolha do produtor dos
 *   dados e não do site.
 *
 * Este arquivo é carregado por todas as páginas e não depende de nada.
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

  /** Um nó de citação: link para a fonte, registro completo no tooltip. */
  function node(key) {
    const entry = registry.get(key);
    // Marcador sem registro fica literal de propósito: é visível na revisão e no
    // teste, em vez de sumir e deixar a frase citando o nada.
    if (!entry) return document.createTextNode(`[[${key}]]`);
    const link = document.createElement("a");
    link.className = "site-ref";
    link.href = entry.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    // `title` é o tooltip nativo: não precisa de posicionamento, funciona em
    // qualquer navegador e vai junto do link para o leitor de tela.
    link.title = entry.citation;
    link.textContent = entry.short;
    link.setAttribute("aria-label", `${entry.short}. ${entry.citation}`);
    return link;
  }

  /** Texto com marcadores -> fragmento com os links no lugar deles. */
  function expand(text) {
    const source = String(text);
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of source.matchAll(MARKER)) {
      if (match.index > cursor) {
        fragment.appendChild(document.createTextNode(source.slice(cursor, match.index)));
      }
      fragment.appendChild(node(match[1]));
      cursor = match.index + match[0].length;
    }
    if (cursor < source.length) fragment.appendChild(document.createTextNode(source.slice(cursor)));
    return fragment;
  }

  /** Mesma expansão em texto puro, para onde não cabe marcação. */
  function plain(text) {
    return String(text).replace(MARKER, (_marker, key) => {
      const entry = registry.get(key);
      return entry ? entry.short : key;
    });
  }

  function keysIn(text) {
    return [...new Set([...String(text).matchAll(MARKER)].map((match) => match[1]))];
  }

  function get(key) {
    return registry.get(key) || null;
  }

  /**
   * Troca os marcadores do HTML estático já renderizado.
   *
   * Percorre nós de TEXTO, nunca `innerHTML`: o conteúdo vem do template, mas
   * reescrever markup para inserir um link abriria a porta para injeção no dia
   * em que alguma dessas frases passar a vir de dados.
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
        // Bibliografia ilegível não pode derrubar a página: os marcadores ficam
        // literais e o resto do conteúdo continua de pé.
        register(null);
      }
    }
    decorate(document.body);
  }

  window.labmimReferences = { register, expand, plain, keysIn, get, decorate };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
