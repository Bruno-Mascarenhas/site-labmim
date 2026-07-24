#!/usr/bin/env bash
# Exporta um PDF da apresentacao para cada tema instalado, em assets/theme-previews/,
# para comparar lado a lado antes de trocar o tema oficial em slides.md.
#
# Uso:  ./preview-themes.sh [tema ...]      (sem argumentos = lista padrao)
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
fi

THEMES=("$@")
if [ ${#THEMES[@]} -eq 0 ]; then
  THEMES=(seriph default)
fi

mkdir -p assets/theme-previews
for t in "${THEMES[@]}"; do
  tmp="slides.preview-$t.md"
  sed "s/^theme: .*$/theme: $t/" slides.md > "$tmp"
  echo ">> $t"
  npx slidev export "$tmp" --format pdf \
      --output "assets/theme-previews/$t.pdf" --timeout 120000 >/dev/null 2>&1 \
    && echo "   ok: assets/theme-previews/$t.pdf" \
    || echo "   FALHOU (tema instalado? veja devDependencies)"
  rm -f "$tmp"
done
echo
echo "Compare os PDFs em assets/theme-previews/."
echo "Para adotar um tema: troque 'theme:' no topo de slides.md e rode npm run export:pdf."
