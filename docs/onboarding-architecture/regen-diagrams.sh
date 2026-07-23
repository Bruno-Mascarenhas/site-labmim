#!/usr/bin/env bash
# Regenera os SVGs de public/diagrams/ a partir das fontes .mmd de diagrams/.
# Rode sempre que editar um .mmd. Requer: npm install (traz @mermaid-js/mermaid-cli).
# Observacao: os posters autorais em public/diagrams/ NAO sao gerados aqui — sao SVGs
# escritos a mao (edite o proprio SVG): arquitetura-poster.svg, micrometeorology-overview.svg
# e add-wrf-variable.svg. Para conferir o visual sem exportar o deck, use render-svg.mjs.
set -euo pipefail
cd "$(dirname "$0")"

# O node do projeto costuma vir do nvm, que nao esta no PATH de shells nao-interativos.
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
fi
if ! command -v node >/dev/null 2>&1; then
  echo "erro: 'node' nao encontrado. Ative a versao do .nvmrc (nvm use) e rode de novo." >&2
  exit 1
fi

MMDC_JS="./node_modules/@mermaid-js/mermaid-cli/src/cli.js"
if [ ! -f "$MMDC_JS" ]; then
  echo "erro: mermaid-cli ausente. Rode 'npm install' nesta pasta." >&2
  exit 1
fi

# O Chromium do mermaid-cli precisa de --no-sandbox neste ambiente.
CFG="$(mktemp)"
printf '{"args":["--no-sandbox","--disable-setuid-sandbox"]}' > "$CFG"
trap 'rm -f "$CFG"' EXIT

mkdir -p public/diagrams
for src in diagrams/*.mmd; do
  name="$(basename "$src" .mmd)"
  echo ">> $name"
  node "$MMDC_JS" -i "$src" -o "public/diagrams/$name.svg" -p "$CFG" -b transparent >/dev/null
done
echo "OK: SVGs atualizados em public/diagrams/"
