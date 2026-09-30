#!/bin/bash
# Atualiza, de hora em hora, o payload que a página de Monitoramento desenha:
#   1. traz do PC da estação o que o datalogger acrescentou (sincroniza_sensores_lbm.sh)
#   2. refaz só a janela recente do acervo, a partir das duas tabelas vivas
#      (mm-archive --source: a mesma cadeia de controle de qualidade do acervo completo)
#   3. gera SITE_DIR/Monitoramento/monitoring.json com a camada do WRF de SERIE_WRF.
# Cron: 5 * * * *. Log por dia em LOG_DIR/AAAAMMDD-site-monitoramento.log.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/comum.sh"
abre_log_e_trava site-monitoramento

janela=$MICRO_DIR/output/janela

echo "$(agora) ===== inicio"

"$DIR_OPERACAO/sincroniza_sensores_lbm.sh" \
  || echo "$(agora) AVISO: sincronizacao falhou; seguindo com o que ja esta em data/"

cd "$MICRO_DIR" || exit 1

# -d continua apontando para data/: os fatores do anel de sombreamento vêm de lá.
if ! mm-archive --source "data/$TABELA_LENTA" --source "data/$TABELA_RAIN" \
     -d data -o "$janela"; then
  echo "$(agora) ERRO: mm-archive da janela falhou; Monitoramento nao atualizado"
  exit 1
fi

if ! mm-monitoring -i "$janela" -w "$SERIE_WRF" -o "$SITE_DIR/Monitoramento"; then
  echo "$(agora) ERRO: mm-monitoring falhou"
  exit 1
fi

echo "$(agora) ===== fim"
