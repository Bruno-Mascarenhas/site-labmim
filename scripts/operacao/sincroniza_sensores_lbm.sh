#!/bin/bash
# Traz as tabelas que o datalogger está gravando (TABELA_LENTA, TABELA_RAIN) do
# PC da estação, um Windows com OpenSSH Server, para MICRO_DIR/data, via SFTP
# com chave. Chamado pelas outras rotinas antes de gerar os dados do site; a
# saída vai para quem chamou.
#
# As tabelas só crescem, então cada execução baixa apenas o que o logger
# acrescentou desde a última (reget do sftp). Para confirmar que o arquivo remoto
# ainda é a continuação da cópia local, os últimos SOBREPOSICAO bytes locais são
# baixados de novo e comparados; se não baterem (o logger trocou de arquivo ou de
# programa), o arquivo é baixado inteiro.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/comum.sh"

DESTINO=$MICRO_DIR/data
ARQUIVOS=("$TABELA_LENTA" "$TABELA_RAIN")
SOBREPOSICAO=8192   # ~30 registros com carimbo de hora: um arquivo trocado não coincide nisso

exec 8> "$DESTINO/.sincroniza.lock"
flock -n 8 || { log "outra sincronizacao em andamento, saindo"; exit 0; }

# Temporário dentro do destino para o mv final ser atômico (mesmo filesystem):
# quem lê data/ nunca vê um arquivo pela metade.
TMP=$(mktemp -d "$DESTINO/.sincroniza.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

ip=$(getent hosts "$ESTACAO_HOST" | awk '{print $1; exit}')
[ -z "$ip" ] && ip=$(nmblookup "$ESTACAO_NETBIOS" 2>/dev/null | awk '/<00>/ {print $1; exit}')
[ -n "$ip" ] || falha "$ESTACAO_HOST / $ESTACAO_NETBIOS nao encontrado na rede (PC desligado?)"

# O known_hosts guarda a chave do PC pelo nome (HostKeyAlias), não pelo IP que muda.
sftp_lote() {
  sftp -b "$1" -i "$ESTACAO_CHAVE" \
    -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new \
    -o HostKeyAlias="$ESTACAO_NETBIOS" -o CheckHostIP=no \
    "$ESTACAO_USUARIO@$ip" > /dev/null 2> "$TMP/erro" && return 0
  log "ERRO no sftp: $(tr '\n' ' ' < "$TMP/erro")"
  return 1
}

# 1) Parte da cópia local sem os últimos SOBREPOSICAO bytes e continua dali.
#    Sem cópia local, o reget baixa o arquivo inteiro.
for f in "${ARQUIVOS[@]}"; do
  if [ -f "$DESTINO/$f" ]; then
    cp "$DESTINO/$f" "$TMP/$f"
    tamanho=$(stat -c%s "$TMP/$f")
    k=$(( tamanho < SOBREPOSICAO ? tamanho : SOBREPOSICAO ))
    tail -c "$k" "$TMP/$f" > "$TMP/$f.sobreposicao"
    truncate -s $(( tamanho - k )) "$TMP/$f"
  fi
  # O '-' deixa o lote seguir se o reget falhar (remoto menor que o local):
  # a comparação abaixo manda esse arquivo para o download completo.
  echo "-reget \"$ESTACAO_ORIGEM/$f\" \"$TMP/$f\""
done > "$TMP/lote.sftp"

sftp_lote "$TMP/lote.sftp" || exit 1

# 2) Os bytes baixados de novo têm que ser os mesmos que já tínhamos. Comparados
#    com cmp -i, sem pipe: tail|head sob pipefail morre de SIGPIPE quando o
#    trecho passa do buffer do pipe e acusaria divergência que não existe.
completos=()
for f in "${ARQUIVOS[@]}"; do
  [ -f "$TMP/$f.sobreposicao" ] || continue
  k=$(stat -c%s "$TMP/$f.sobreposicao")
  inicio=$(( $(stat -c%s "$DESTINO/$f") - k ))
  if ! cmp -s -i "$inicio:0" -n "$k" "$TMP/$f" "$TMP/$f.sobreposicao"; then
    log "$f: o arquivo remoto nao continua a copia local, baixando inteiro"
    completos+=("$f")
  fi
done

if [ ${#completos[@]} -gt 0 ]; then
  for f in "${completos[@]}"; do
    echo "get \"$ESTACAO_ORIGEM/$f\" \"$TMP/$f\""
  done > "$TMP/lote.sftp"
  sftp_lote "$TMP/lote.sftp" || exit 1
fi

# 3) Confere e publica.
status=0
for f in "${ARQUIVOS[@]}"; do
  novo=$TMP/$f
  atual=$DESTINO/$f
  antes=$( [ -f "$atual" ] && stat -c%s "$atual" || echo 0 )

  # O LoggerNet pode estar gravando durante a cópia: descarta a última linha
  # se ela veio sem o fim de linha. A próxima execução traz o registro inteiro.
  [ -n "$(tail -c1 "$novo")" ] && sed -i '$d' "$novo"

  # A tabela só cresce. Se veio menor, o logger trocou de programa ou de
  # arquivo: não sobrescreve a cópia local, alguém precisa olhar.
  if [ "$(stat -c%s "$novo")" -lt "$antes" ]; then
    log "ERRO: $f veio menor ($(stat -c%s "$novo") < $antes bytes); mantida a copia local"
    status=1
    continue
  fi

  chmod 664 "$novo"
  mv -f "$novo" "$atual"
  log "$f ok, +$(( $(stat -c%s "$atual") - antes )) bytes (total $(stat -c%s "$atual")), ultimo registro $(tail -n1 "$atual" | cut -d, -f1)"
done

exit $status
