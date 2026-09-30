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

agora() { date '+%F %T'; }

# Manda a saída para o log do dia, apaga os logs antigos desta rotina e pega a
# trava; se a execução anterior ainda roda, sai sem erro. $1 é o nome da rotina.
abre_log_e_trava() {
  exec >> "$LOG_DIR/$(date +%Y%m%d)-$1.log" 2>&1
  find "$LOG_DIR" -maxdepth 1 -name "*-$1.log" -mtime +"$LOG_DIAS" -delete
  exec 9> "$LOG_DIR/.$1.lock"
  flock -n 9 || { echo "$(agora) execucao anterior ainda rodando, saindo"; exit 0; }
}
