#!/bin/bash
# Atualiza, a cada 5 min, a página Céu em SITE_DIR/Ceu:
#   1. traz do PC da estação o que o datalogger acrescentou (sincroniza_sensores_lbm.sh)
#   2. publica os documentos da página (allsky publish-site) a partir do que o
#      allsky-watch (allsky-watch.service) vem pontuando nas imagens da câmera,
#      com a difusa medida pela estação ao lado da prevista.
# O Kt × Kd da mesma página (mm-sky) é do registro inteiro e sai uma vez por dia,
# junto da climatologia (ver README.md).
# Sem --prune-frames-days: as imagens da câmera ficam guardadas (~0,6–1,3 GB/dia).
# O watch já descarta sozinho as capturas repetidas do mesmo horário.
# Cron: */5 * * * *. Log por dia em LOG_DIR/AAAAMMDD-site-ceu.log.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/comum.sh"
abre_log_e_trava site-ceu

export OMP_NUM_THREADS=4 MKL_NUM_THREADS=4 ALLSKY_DINOV3_REPO ALLSKY_DINOV3_WEIGHTS

log "===== inicio"

"$DIR_OPERACAO/sincroniza_sensores_lbm.sh" \
  || log "AVISO: sincronizacao falhou; seguindo com o que ja esta em data/"

cd "$MICRO_DIR" || exit 1

# A tabela do logger vira a exportação da estação: sem as linhas de metadados do
# TOA5 (1ª, 3ª e 4ª) e só com os últimos 7 dias (2016 registros de 5 min), que
# cobrem com folga os 3 dias da linha do tempo. Escala "raw": o publicador aplica
# sozinho sentinelas, sensibilidade e anel de sombreamento.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
{ sed -n 2p "data/$TABELA_LENTA"; tail -n 2016 "data/$TABELA_LENTA"; } > "$tmp/estacao.csv"

allsky publish-site \
  --serving "$ALLSKY_SERVING" \
  --watch-dir "$ALLSKY_WATCH_DIR" \
  --out "$SITE_DIR/Ceu" \
  --days 3 \
  --sensor-csv "$tmp/estacao.csv" --sensor-csv-scale raw \
  --trust-checkpoint
rc=$?

# 2 = documentos gravados, mas o watch parece parado (sol acima do piso e nenhuma
# imagem nova): a página já mostra o aviso; aqui só fica registrado.
case $rc in
  0) log "===== fim" ;;
  2) log "AVISO: publicado, mas o allsky-watch parece parado (systemctl --user status allsky-watch)" ;;
  *) log "ERRO: publish-site terminou com codigo $rc" ;;
esac
exit $rc
