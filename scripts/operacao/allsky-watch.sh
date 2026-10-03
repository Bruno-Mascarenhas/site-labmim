#!/bin/bash
# Pontua, sem parar, cada imagem nova da câmera all-sky com os modelos do pin
# ALLSKY_SERVING e grava em ALLSKY_WATCH_DIR as imagens e as previsões que o
# processa_site_ceu.sh publica. Roda como serviço (allsky-watch.service).
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/comum.sh"

export OMP_NUM_THREADS=6 MKL_NUM_THREADS=6

# Os caminhos do pin (checkpoints e relatórios) são relativos ao checkout.
cd "$MICRO_DIR" || exit 1

# exec: o SIGINT de parada do systemd chega direto ao allsky, que fecha o bloco aberto.
exec allsky watch \
  --serving "$ALLSKY_SERVING" \
  --out "$ALLSKY_WATCH_DIR" \
  --trust-checkpoint
