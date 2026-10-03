#!/bin/bash
# Publica SITE_DIR (a saída de `npm run build -- --site=<id>`, com os dados que as
# rotinas depositam) no servidor do site, por FTP com o lftp.
#
# Uso: publica_site_ftp.sh [--dry-run] completo
#      publica_site_ftp.sh [--dry-run] dados DIR...    (ex.: dados Monitoramento Ceu)
#
#   completo  o site inteiro, na ordem de "Deploy em produção" do Architecture.md:
#               1. assets/ (menos assets/graphs/, ver README.md)
#               2. diretórios de dados (GeoJSON, JSON, Climatologia, Monitoramento, Ceu)
#               3. o resto da raiz que não é HTML (.htaccess, robots.txt, sitemap.xml)
#               4. *.html por último (inclusive o 404.html): é o HTML que traz os ?v= novos
#             Uma fase só começa se a anterior terminou bem: nada de HTML sem os assets.
#             Chamado 1×/dia pela cadeia do WRF, depois de ela gerar os dados.
#   dados     só os diretórios de dados pedidos. Chamado pelo processa_site_monitoramento.sh
#             (de hora em hora) e pelo processa_site_ceu.sh (a cada 5 min).
#
# Em cada diretório de dados o manifest.json sobe por último: ele é a fonte do ?v=
# das URLs e, se chegasse antes, o visitante guardaria os bytes antigos sob o ?v=
# novo por até 24 h (regra do .htaccess).
#
# mirror -R --only-newer: só envia o que for mais novo que a cópia do servidor e NUNCA
# apaga nada lá (sem --delete). --overwrite grava por cima (STOR), sem o DELE prévio
# que o mirror faz por padrão: sem ele o index.html ou o manifest.json sumiriam por um
# instante, e de vez se o envio falhasse. Não envia .keep nem os temporários
# .<nome>.tmp-<pid> que o pipeline grava antes do os.replace.
#
# Guarda: só publica de verdade com SITE_FTP_PUBLICAR=S no operacao.env; sem ela
# registra "publicacao desativada" e sai 0. O --dry-run funciona com a guarda desligada
# (conecta e lista o servidor, não envia nada). A senha vai ao lftp pela variável
# LFTP_PASSWORD (--env-password), nunca pela linha de comando nem pelo arquivo de
# comandos, e nunca aparece no log.
#
# Log por dia em LOG_DIR/AAAAMMDD-site-ftp.log. Código de saída: 0 = ok, publicação
# desativada ou "dados" com outra publicação em andamento; 1 = falha; 2 = uso incorreto.
set -uo pipefail
SITE_FTP_PUBLICAR=   # só o operacao.env liga a publicação, nunca o ambiente
. "$(dirname "${BASH_SOURCE[0]}")/comum.sh"

# Diretórios de dados, na ordem do envio: GeoJSON antes do JSON/manifest.json, que
# também versiona as grades.
DADOS=(GeoJSON JSON Climatologia Monitoramento Ceu)
PARALELO=4            # conexões simultâneas do mirror
ESPERA_COMPLETO=1800  # s esperando a trava no modo completo (depois disso, falha)
ESPERA_DADOS=240      # s no modo dados (menos que os 5 min do Céu; depois disso, desiste)
LIMITE_COMPLETO=10800 # s por fase, teto do lftp: um lftp travado seguraria a trava
LIMITE_DADOS=900

uso() {
  echo "uso: $(basename "$0") [--dry-run] completo"
  echo "     $(basename "$0") [--dry-run] dados DIR...   (DIR: ${DADOS[*]})"
}

dry=0
if [ "${1:-}" = "--dry-run" ]; then dry=1; shift; fi
modo=${1:-}
[ $# -gt 0 ] && shift
case $modo in
  completo) [ $# -eq 0 ] || { uso >&2; exit 2; } ;;
  dados)
    [ $# -gt 0 ] || { uso >&2; exit 2; }
    for d in "$@"; do
      [[ " ${DADOS[*]} " == *" $d "* ]] || { echo "diretorio de dados desconhecido: $d" >&2; uso >&2; exit 2; }
    done ;;
  *) uso >&2; exit 2 ;;
esac

# O log é um só para o completo e para os dados de cada rotina: cada linha diz de
# qual publicação é. No terminal (execução manual) mostra e registra.
rotulo="$modo${*:+ $*}"
[ $dry -eq 1 ] && rotulo="$rotulo (dry-run)"
log() { echo "$(date '+%F %T') [$rotulo] $*"; }
if [ -t 1 ]; then
  exec > >(tee -a "$LOG_DIR/$(date +%Y%m%d)-site-ftp.log") 2>&1
else
  exec >> "$LOG_DIR/$(date +%Y%m%d)-site-ftp.log" 2>&1
fi
find "$LOG_DIR" -maxdepth 1 -name '*-site-ftp.log' -mtime +"$LOG_DIAS" -delete

if [ $dry -eq 0 ] && [ "$SITE_FTP_PUBLICAR" != S ]; then
  log "publicacao desativada (SITE_FTP_PUBLICAR != S em $CONFIG)"
  exit 0
fi
for v in SITE_FTP_HOST SITE_FTP_USUARIO SITE_FTP_RAIZ SITE_FTP_SENHA; do
  [ -n "${!v:-}" ] || falha "$v nao definida em $CONFIG"
done

if [ "$modo" = completo ]; then
  # site/ também recebe o build das outras publicações: só sobe a que responde em url.
  url=${SITE_FTP_URL:-https://$SITE_FTP_HOST/}
  url=${url%/}/
  grep -qF "<loc>$url" "$SITE_DIR/sitemap.xml" 2>/dev/null \
    || falha "$SITE_DIR nao e o build da publicacao de $url (sitemap.xml); rode npm run build -- --site=<id>"
  # Nunca o HTML novo sem o .htaccess, nem o .htaccess sem os assets.
  for f in .htaccess index.html assets; do
    [ -e "$SITE_DIR/$f" ] || falha "$SITE_DIR/$f nao existe"
  done
  lista=("${DADOS[@]}")
  espera=$ESPERA_COMPLETO
  limite=$LIMITE_COMPLETO
else
  lista=("$@")
  espera=$ESPERA_DADOS
  limite=$LIMITE_DADOS
fi
for d in "${lista[@]}"; do
  [ -d "$SITE_DIR/$d" ] || falha "$SITE_DIR/$d nao existe"
done

# A rotina horária (Monitoramento) e a de 5 min (Céu) coincidem no minuto 5, e o
# completo diário pode demorar: uma publicação por vez. O dry-run só lê o servidor.
if [ $dry -eq 0 ]; then
  exec 9> "$LOG_DIR/.site-ftp.lock"
  if ! flock -w "$espera" 9; then
    if [ "$modo" = dados ]; then
      log "outra publicacao ainda rodando depois de ${espera}s; fica para a proxima"
      exit 0
    fi
    falha "outra publicacao ainda rodando depois de ${espera}s"
  fi
fi

log "===== inicio"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

q() { printf '"%s"' "${1//\"/\\\"}"; }   # aspas para o lftp
OPCOES="--only-newer --overwrite --no-perms --parallel=$PARALELO"
n=0   # número do mirror; no dry-run cada um grava o seu roteiro em $tmp/roteiro.NNN

# fase TÍTULO ARGS...: uma sessão do lftp com um "mirror -R" por ARGS (origem, destino
# e filtros, já com as aspas do lftp), um depois do outro. cmd:fail-exit para no
# primeiro erro. Sessões separadas por fase deixam o log na ordem e param o completo
# na fase que falhar.
fase() {
  local titulo=$1 args primeiro=$((n + 1)) rc
  shift
  log "-- $titulo"
  {
    echo "set net:timeout 30"
    echo "set net:max-retries 3"
    echo "set net:reconnect-interval-base 10"
    echo "set ftp:ssl-allow no"       # o servidor não oferece AUTH TLS (ver README.md)
    echo "set ftp:list-options -a"    # a listagem precisa trazer o .htaccess
    echo "set xfer:log no"            # o registro fica neste log, não em ~/.local/share/lftp
    echo "set cmd:fail-exit yes"
    echo "cd $(q "$SITE_FTP_RAIZ")"
    for args in "$@"; do
      n=$((n + 1))
      if [ $dry -eq 1 ]; then
        echo "mirror -R $OPCOES --script=$(q "$(printf '%s/roteiro.%03d' "$tmp" "$n")") $args"
      else
        echo "mirror -R -v $OPCOES $args"
      fi
    done
    echo "bye"
  } > "$tmp/comandos.lftp"

  # Mensagens do lftp em inglês (LANGUAGE vazio + C.UTF-8), estáveis para o resumo.
  # O tee leva a saída ao log enquanto a fase roda (a de dados leva minutos).
  LFTP_PASSWORD=$SITE_FTP_SENHA LANGUAGE='' LC_ALL=C.UTF-8 \
    timeout --kill-after=60 "$limite" \
    lftp --env-password -u "$SITE_FTP_USUARIO" "$SITE_FTP_HOST" \
    < "$tmp/comandos.lftp" 2>&1 | tee -a "$tmp/saida.todas"
  rc=${PIPESTATUS[0]}
  if [ $dry -eq 1 ]; then
    for ((i = primeiro; i <= n; i++)); do
      cat "$(printf '%s/roteiro.%03d' "$tmp" "$i")" 2>/dev/null
    done
  fi
  if [ "$rc" -ne 0 ]; then
    [ "$rc" -eq 124 ] && log "ERRO: lftp passou do limite de ${limite}s"
    log "ERRO: $titulo: lftp terminou com codigo $rc"
  fi
  return "$rc"
}

mirrors_dados=()
for d in "${lista[@]}"; do
  mirrors_dados+=("-X '.*' -X manifest.json $(q "$SITE_DIR/$d") $(q "$d")")
done
for d in "${lista[@]}"; do
  [ -f "$SITE_DIR/$d/manifest.json" ] && mirrors_dados+=("-I manifest.json $(q "$SITE_DIR/$d") $(q "$d")")
done

interrompido="interrompido: as fases seguintes nao foram enviadas"
if [ "$modo" = completo ]; then
  fase "1/4 assets/" "-X '.*' -x '^graphs/' $(q "$SITE_DIR/assets") assets" || falha "$interrompido"
  fase "2/4 dados: ${lista[*]} (manifest.json por ultimo)" "${mirrors_dados[@]}" || falha "$interrompido"
  fase "3/4 raiz sem HTML (.htaccess, robots.txt, sitemap.xml)" \
    "-r -X '*.html' -X .keep -X '.*.tmp-*' $(q "$SITE_DIR") ." || falha "$interrompido"
  fase "4/4 *.html" "-r -I '*.html' $(q "$SITE_DIR") ." || falha "$interrompido"
else
  fase "dados: ${lista[*]} (manifest.json por ultimo)" "${mirrors_dados[@]}" || falha "$interrompido"
fi

if [ $dry -eq 1 ]; then
  # O roteiro do mirror -R lista cada envio como "get [-e] -O <destino> file:<local>".
  log "resumo do que seria enviado (grupo, arquivos, bytes):"
  cat "$tmp"/roteiro.* 2>/dev/null \
    | awk '$1 == "get" || $1 == "put" {f = $NF; sub(/^file:/, "", f); print f}' \
    | xargs -d '\n' -r stat -c '%s %n' \
    | awk -v p="$SITE_DIR/" '
        { s = $1; rel = substr($0, index($0, " ") + 1 + length(p))
          if (index(rel, "/")) g = substr(rel, 1, index(rel, "/"))
          else if (rel ~ /\.html$/) g = "*.html"
          else g = "raiz"
          n[g]++; b[g] += s; N++; B += s }
        END { for (g in n) printf "    %-16s %7d %14d\n", g, n[g], b[g]
              printf "    %-16s %7d %14d\n", "TOTAL", N, B }'
else
  log "arquivos enviados: $(grep -c '^Transferring file' "$tmp/saida.todas")"
fi
log "===== fim"
