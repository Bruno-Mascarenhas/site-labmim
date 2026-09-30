#!/bin/bash
# Traz as tabelas que o datalogger está gravando (TABELA_LENTA, TABELA_RAIN) do
# PC da estação, um Windows com OpenSSH Server, para MICRO_DIR/data, via SFTP
# com chave, baixando só o que o logger acrescentou (ver "Como a cópia da estação
# funciona" no README.md). Chamado pelas rotinas do site antes de gerar os dados;
# a saída vai para quem chamou.
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

# 1) Cada tabela com cópia local recomeça num arquivo esparso do tamanho dela
#    menos SOBREPOSICAO bytes (nada é copiado) e o reget continua dali. Sem cópia
#    local, o reget baixa o arquivo inteiro.
declare -A antes inicio
for f in "${ARQUIVOS[@]}"; do
  antes[$f]=$(stat -c%s "$DESTINO/$f" 2>/dev/null) || antes[$f]=0
  if [ "${antes[$f]}" -gt 0 ]; then
    inicio[$f]=$(( ${antes[$f]} > SOBREPOSICAO ? ${antes[$f]} - SOBREPOSICAO : 0 ))
    truncate -s "${inicio[$f]}" "$TMP/$f"
  fi
  # O '-' deixa o lote seguir se o reget falhar (remoto menor que o local):
  # a comparação abaixo manda esse arquivo para o download completo.
  echo "-reget \"$ESTACAO_ORIGEM/$f\" \"$TMP/$f\""
done > "$TMP/lote.sftp"

sftp_lote "$TMP/lote.sftp" || exit 1

# 2) Os bytes baixados de novo têm que ser os mesmos da cópia local, que não muda
#    enquanto a trava está pega. Se não forem, a tabela é baixada inteira.
for f in "${ARQUIVOS[@]}"; do
  [ -n "${inicio[$f]-}" ] || continue
  cmp -s -i "${inicio[$f]}" -n $(( ${antes[$f]} - ${inicio[$f]} )) "$DESTINO/$f" "$TMP/$f" && continue
  log "$f: o arquivo remoto nao continua a copia local, baixando inteiro"
  unset "inicio[$f]"
  echo "get \"$ESTACAO_ORIGEM/$f\" \"$TMP/$f\"" >> "$TMP/completos.sftp"
done

if [ -s "$TMP/completos.sftp" ]; then
  sftp_lote "$TMP/completos.sftp" || exit 1
fi

# 3) Confere e publica.
status=0
for f in "${ARQUIVOS[@]}"; do
  novo=$TMP/$f
  atual=$DESTINO/$f

  # O LoggerNet pode estar gravando durante a cópia: descarta a última linha
  # se ela veio sem o fim de linha. A próxima execução traz o registro inteiro.
  [ -n "$(tail -c1 "$novo")" ] && truncate -s "-$(tail -n1 "$novo" | wc -c)" "$novo"
  depois=$(stat -c%s "$novo")

  # A tabela só cresce. Se veio menor, o logger trocou de programa ou de
  # arquivo: não sobrescreve a cópia local, alguém precisa olhar.
  if [ "$depois" -lt "${antes[$f]}" ]; then
    log "ERRO: $f veio menor ($depois < ${antes[$f]} bytes); mantida a copia local"
    status=1
    continue
  fi

  # Sem registro novo, a cópia incremental não publica nada e data/ fica como
  # está. Com registro novo, o buraco do arquivo esparso vem da cópia local.
  if [ -z "${inicio[$f]-}" ] || [ "$depois" -gt "${antes[$f]}" ]; then
    [ -n "${inicio[$f]-}" ] \
      && dd if="$atual" of="$novo" bs=1M count="${inicio[$f]}" iflag=count_bytes conv=notrunc status=none
    chmod 664 "$novo"
    mv -f "$novo" "$atual"
  fi
  log "$f ok, +$(( depois - ${antes[$f]} )) bytes (total $depois), ultimo registro $(tail -n1 "$atual" | cut -d, -f1)"
done

exit $status
