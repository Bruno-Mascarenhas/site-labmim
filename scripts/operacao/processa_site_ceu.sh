#!/bin/bash
# Atualiza, a cada 5 min, a página Céu em SITE_DIR/Ceu:
#   1. traz do PC da estação o que o datalogger acrescentou (sincroniza_sensores_lbm.sh)
#   2. publica os documentos da página (allsky publish-site) a partir do que o
#      allsky-watch (allsky-watch.service) vem pontuando nas imagens da câmera,
#      com a difusa medida pela estação ao lado da prevista.
#   3. envia SITE_DIR/Ceu ao site por FTP (publica_site_ftp.sh dados Ceu).
# O Kt × Kd da mesma página (mm-sky) é do registro inteiro e sai uma vez por dia,
# junto da climatologia (ver README.md).
# --prune-frames-days 36500 (100 anos): o publish-site apaga por padrão as imagens
# da câmera com mais de 14 dias e não aceita 0 para desligar a limpeza; aqui elas
# ficam guardadas para montar datasets (~0,6–1,3 GB/dia). O watch já descarta
# sozinho as capturas repetidas do mesmo horário.
# Cron: */5 * * * *. Log por dia em LOG_DIR/AAAAMMDD-site-ceu.log.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/comum.sh"
inicia_rotina site-ceu

export OMP_NUM_THREADS=4 MKL_NUM_THREADS=4

# A tabela do logger vira a exportação da estação: sem as linhas de metadados do
# TOA5 (1ª, 3ª e 4ª) e só com os últimos 7 dias (2016 registros de 5 min), que
# cobrem com folga os 3 dias da linha do tempo. Escala "raw": o publicador aplica
# sozinho sentinelas, sensibilidade e anel de sombreamento.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
{ sed -n '2{p;q}' "data/$TABELA_LENTA"; tail -n 2016 "data/$TABELA_LENTA"; } > "$tmp/estacao.csv"

allsky publish-site \
  --serving "$ALLSKY_SERVING" \
  --watch-dir "$ALLSKY_WATCH_DIR" \
  --out "$SITE_DIR/Ceu" \
  --days 3 \
  --prune-frames-days 36500 \
  --sensor-csv "$tmp/estacao.csv" --sensor-csv-scale raw \
  --trust-checkpoint
rc=$?

# 0 e 2 gravaram os documentos: envia ao site. Inerte enquanto SITE_FTP_PUBLICAR não
# for S. Uma falha do FTP fica registrada, mas não muda o código da geração; o
# detalhe vai no log do FTP.
if [ $rc -eq 0 ] || [ $rc -eq 2 ]; then
  "$DIR_OPERACAO/publica_site_ftp.sh" dados Ceu \
    || log "AVISO: publicacao FTP falhou (codigo $?); ver $LOG_DIR/$(date +%Y%m%d)-site-ftp.log"
fi

# 2 = documentos gravados, mas o watch parece parado (sol acima do piso e nenhuma
# imagem nova): a página já mostra o aviso; aqui só fica registrado.
case $rc in
  0) log "===== fim" ;;
  2) log "AVISO: publicado, mas o allsky-watch parece parado (systemctl --user status allsky-watch)" ;;
  *) log "ERRO: publish-site terminou com codigo $rc" ;;
esac
exit $rc
