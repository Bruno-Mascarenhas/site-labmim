#!/bin/bash
# Atualiza, de hora em hora, o payload que a página de Monitoramento desenha:
#   1. traz do PC da estação o que o datalogger acrescentou (sincroniza_sensores_lbm.sh)
#   2. refaz só a janela recente do acervo, a partir das duas tabelas vivas
#      (mm-archive --source: a mesma cadeia de controle de qualidade do acervo completo)
#   3. gera SITE_DIR/Monitoramento/monitoring.json com a camada do WRF de SERIE_WRF.
# Cron: 5 * * * *. Log por dia em LOG_DIR/AAAAMMDD-site-monitoramento.log.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/comum.sh"
inicia_rotina site-monitoramento

janela=output/janela
# -d continua apontando para data/: os fatores do anel de sombreamento vêm de lá.
mm-archive --source "data/$TABELA_LENTA" --source "data/$TABELA_RAIN" -d data -o "$janela" \
  || falha "mm-archive da janela falhou; Monitoramento nao atualizado"

mm-monitoring -i "$janela" -w "$SERIE_WRF" -o "$SITE_DIR/Monitoramento" \
  || falha "mm-monitoring falhou"

log "===== fim"
