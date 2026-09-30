# Carregado (com `.`) pelas rotinas de operação: lê a configuração e completa os
# padrões. Não é executável sozinho.

DIR_OPERACAO=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CONFIG=${OPERACAO_ENV:-$DIR_OPERACAO/operacao.env}
if [ ! -r "$CONFIG" ]; then
  echo "configuracao ausente: copie $DIR_OPERACAO/operacao.env.example para $CONFIG e ajuste" >&2
  exit 1
fi
# shellcheck source=operacao.env.example
. "$CONFIG"

SITE_DIR=${SITE_DIR:-$(cd "$DIR_OPERACAO/../.." && pwd)/site}
LOG_DIAS=${LOG_DIAS:-30}
export PATH="$MICRO_BIN:$PATH"

log() { echo "$(date '+%F %T') $*"; }
falha() { log "ERRO: $*"; exit 1; }

# Começo das rotinas do site ($1 é o nome delas): manda a saída para o log do
# dia, apaga os logs antigos da rotina e pega a trava (se a execução anterior
# ainda roda, sai sem erro); depois traz da estação o que o datalogger
# acrescentou e entra em MICRO_DIR, de onde os caminhos data/ e output/ partem.
inicia_rotina() {
  exec >> "$LOG_DIR/$(date +%Y%m%d)-$1.log" 2>&1
  find "$LOG_DIR" -maxdepth 1 -name "*-$1.log" -mtime +"$LOG_DIAS" -delete
  exec 9> "$LOG_DIR/.$1.lock"
  flock -n 9 || { log "execucao anterior ainda rodando, saindo"; exit 0; }
  log "===== inicio"
  "$DIR_OPERACAO/sincroniza_sensores_lbm.sh" \
    || log "AVISO: sincronizacao falhou; seguindo com o que ja esta em data/"
  cd "$MICRO_DIR" || exit 1
}
