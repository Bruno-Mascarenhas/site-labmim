# Operação: os dados do site no servidor

O build gera o código do site. Os dados que as páginas buscam em tempo de execução
(`JSON/`, `GeoJSON/`, `Climatologia/`, `Monitoramento/`, `Ceu/`) vêm do
[micrometeorology](https://github.com/Bruno-Mascarenhas/micrometeorology) e são
depositados dentro de `site/`, onde o git só guarda o `.keep`
(ver [De onde vêm os dados](../../README.md#de-onde-vêm-os-dados)). As rotinas desta
pasta mantêm esses dados frescos no servidor de operação da LabMiM/UFBA e publicam
`site/` por FTP ([`publica_site_ftp.sh`](#publicação-por-ftp)), na ordem de
[Deploy em produção](../../Architecture.md#deploy-em-produção).

## Quem gera e publica o quê

| Cadência                  | Rotina                                           | Escreve em `site/`                                               | Publica por FTP                                                  |
| ------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1×/dia, após a rodada WRF | cadeia do WRF: `mm-wrf-geojson`, `mm-wrf-series` | `JSON/`, `GeoJSON/` (e a série operacional, fora de `site/`)     | o site inteiro, no fim da cadeia: `publica_site_ftp.sh completo` |
| 1×/dia, após a série      | [acervo, climatologia e Kt × Kd](#rotina-diária) | `Climatologia/`, `Ceu/ktkd*.json`, `Ceu/kt_cumulative.json`      | no mesmo `completo` da cadeia                                    |
| de hora em hora           | `processa_site_monitoramento.sh`                 | `Monitoramento/monitoring.json`                                  | `Monitoramento/`, logo depois de gerar                           |
| a cada 5 min              | `processa_site_ceu.sh`                           | `Ceu/frame.json`, `Ceu/timeline.json`, `Ceu/model.json`, imagens | `Ceu/`, logo depois de gerar                                     |
| contínuo                  | `allsky-watch.service` (`allsky-watch.sh`)       | nada: imagens da câmera e previsões em `ALLSKY_WATCH_DIR`        | nada                                                             |

As duas rotinas do cron começam por `sincroniza_sensores_lbm.sh`, que traz do PC da
estação o que o datalogger acrescentou às tabelas, e terminam publicando o próprio
diretório (`publica_site_ftp.sh dados Monitoramento` ou `dados Ceu`; o Céu publica
também quando o `publish-site` sai com 2). Uma falha do FTP vira `AVISO` no log da
rotina, sem mudar o código dela, e o que não subiu vai na execução seguinte (salvo um
envio que caiu no meio, ver [Cuidados conhecidos](#cuidados-conhecidos)). O código do site
(`assets/`, `.htaccess`, HTML) só sobe no `completo`, que envia o que estiver em
`site/`: um `npm run build -- --site=ufba` neste checkout entra em produção na rodada
seguinte, ou antes, com `./publica_site_ftp.sh completo` à mão. Início e Equipe são
estáticas.

### Rotina diária

O acervo completo (dez anos, ~15 s e ~3 GB de pico) é refeito uma vez por dia, logo
depois de a série do WRF ganhar o dia novo, e dele saem a climatologia e o Kt × Kd:

```bash
cd "$MICRO_DIR"
mm-archive -d data -o output/archive
mm-climatology -i output/archive/station_hourly.parquet -w "$SERIE_WRF" -o "$SITE_DIR/Climatologia"
mm-sky -i output/archive/station_hourly.parquet -o "$SITE_DIR/Ceu"
```

Sem `--strict` no `mm-archive`: depois do fim da auditoria do acervo ele exige uma
amostra a cada 5 min, e o logger perde amostras de verdade (faltam na própria tabela
do Windows), então reprovaria todo dia. A verificação continua impressa e em
`output/archive/archive_report.json`.

A cadeia do WRF fica fora deste repositório; no fim dela, depois destes comandos, ela
chama `publica_site_ftp.sh completo`.

## Instalação

1. **micrometeorology**: checkout, ambiente e `make install-dev` (o torch CUDA só
   onde a GPU o roda; CPU no resto). Em `data/` ficam as tabelas históricas em
   `data/dados-labmim/`, as vivas na raiz e `teorica_2016-2030.csv`, sem o qual a
   difusa não é corrigida e o `mm-archive` para. Rode
   `python scripts/converter_teorica.py --data data` uma vez, e de novo sempre que
   o CSV for trocado: sem o parquet que ele gera, cada rotina relê os ~200 MB do
   CSV. Para o Céu, os checkpoints do pin
   `configs/allsky/serving/ceu.yaml` (com o SHA-256 dele), os relatórios de avaliação
   que o pin cita e o DINOv3 (fonte clonada e pesos).
2. **Configuração**: `cp operacao.env.example operacao.env`, `chmod 600 operacao.env` e
   ajuste. O `operacao.env` fica fora do git: ele nomeia a máquina e o usuário da
   estação e a conta do FTP.
3. **PC da estação (Windows)**: OpenSSH Server e um usuário para a cópia, que entra
   por chave. No PowerShell como administrador, com o conteúdo de
   `$ESTACAO_CHAVE.pub` (gerada com `ssh-keygen -t ed25519 -N "" -f "$ESTACAO_CHAVE"`):

   ```powershell
   Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
   Start-Service sshd
   Set-Service sshd -StartupType Automatic
   if (!(Get-NetFirewallRule -Name OpenSSH-Server-In-TCP -ErrorAction SilentlyContinue)) {
     New-NetFirewallRule -Name OpenSSH-Server-In-TCP -DisplayName "OpenSSH Server (sshd)" -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow
   }
   $usuario = "usuario_da_copia"
   $senha = Read-Host -AsSecureString "Senha para $usuario"
   New-LocalUser -Name $usuario -Password $senha -PasswordNeverExpires -AccountNeverExpires -Description "Copia de arquivos via SSH"
   Add-LocalGroupMember -SID S-1-5-32-545 -Member $usuario
   $k = "C:\ProgramData\ssh\${usuario}_authorized_keys"
   Set-Content -Path $k -Encoding ascii -Value 'ssh-ed25519 AAAA... (a chave pública)'
   icacls $k /setowner "*S-1-5-32-544"
   icacls $k /inheritance:r /grant "*S-1-5-32-544:F" /grant "*S-1-5-18:F"
   Add-Content -Path C:\ProgramData\ssh\sshd_config -Encoding ascii -Value "`r`nMatch User $usuario`r`n    AuthorizedKeysFile __PROGRAMDATA__/ssh/${usuario}_authorized_keys"
   Restart-Service sshd
   ```

   O usuário é comum (grupo Usuários, por SID para funcionar em Windows em
   português) e a chave fica em `ProgramData`, não no perfil dele, que só existe
   depois do primeiro login. A senha só existe porque o Windows exige uma. Não há
   trava de IP: os IPs da rede mudam a cada reinício, e por isso as rotinas acham o
   PC pelo nome (`ESTACAO_HOST` por mDNS, `ESTACAO_NETBIOS` se o mDNS não responder).

4. **Teste**: `./sincroniza_sensores_lbm.sh` deve imprimir uma linha `ok` por tabela.
5. **allsky-watch**, como serviço do usuário que sobrevive a reinícios:

   ```bash
   sed "s#@DIR_OPERACAO@#$PWD#" allsky-watch.service > ~/.config/systemd/user/allsky-watch.service
   systemctl --user daemon-reload && systemctl --user enable --now allsky-watch
   sudo loginctl enable-linger "$USER"
   ```

6. **Publicação por FTP**: `sudo apt install lftp` e, no `operacao.env`,
   `SITE_FTP_HOST`, `SITE_FTP_USUARIO`, `SITE_FTP_RAIZ` (a pasta remota que é a raiz do
   site) e a senha em `SITE_FTP_SENHA`: escrita ali, com o arquivo em `chmod 600`, ou
   lida de um arquivo de segredos que a define, sem copiá-la (ver o exemplo). Com a
   guarda ainda desligada, confira a conexão e o que seria enviado:

   ```bash
   ./publica_site_ftp.sh --dry-run dados Monitoramento
   ./publica_site_ftp.sh --dry-run completo
   ```

   Depois ligue a guarda (`SITE_FTP_PUBLICAR=S`) e faça a cadeia diária do WRF chamar
   `publica_site_ftp.sh completo` no fim, depois de gerar os dados do dia.

7. **cron**:

   ```cron
   5 * * * *   /caminho/para/site-labmim/scripts/operacao/processa_site_monitoramento.sh
   */5 * * * * /caminho/para/site-labmim/scripts/operacao/processa_site_ceu.sh
   ```

   O `processa_site_ceu.sh` faz o papel do `allsky-publish.timer` do
   micrometeorology: não habilite os dois, que escreveriam no mesmo `Ceu/`.

## Publicação por FTP

`publica_site_ftp.sh` envia `site/` com o `lftp`, em
`mirror -R --only-newer --overwrite --no-perms --parallel=4`: só o que for mais novo que
a cópia do servidor, gravando por cima (sem o `DELE` prévio, que deixaria o `index.html`
ou o `manifest.json` sumidos por um instante, e de vez se o envio falhasse) e sem nunca
apagar nada lá (sem `--delete`).

```bash
./publica_site_ftp.sh [--dry-run] completo       # o site inteiro (cadeia diária do WRF)
./publica_site_ftp.sh [--dry-run] dados DIR...   # só esses diretórios de dados (rotinas do cron)
```

O `completo` sobe em quatro fases, cada uma só depois de a anterior terminar bem, para
nunca haver HTML novo sem os seus assets:

1. `assets/`, menos `assets/graphs/`: ali o PC da estação publica, de hora em hora, os
   gráficos que as páginas antigas usam, e as cópias do repositório são velhas.
2. Os diretórios de dados, `GeoJSON/` antes de `JSON/` (o `JSON/manifest.json` também
   versiona as grades) e, em cada um, o `manifest.json` por último: ele é a fonte do
   `?v=` das URLs e, se chegasse antes, o visitante guardaria os bytes antigos sob o
   `?v=` novo por até 24 h.
3. O resto da raiz que não é HTML: `.htaccess`, `robots.txt`, `sitemap.xml`.
4. Os `*.html`, inclusive o `404.html`, por último: é o HTML que traz os `?v=` novos.

O `dados` faz só a fase 2, com os diretórios pedidos. Nenhuma fase envia `.keep` nem os
temporários `.<nome>.tmp-<pid>` que o pipeline grava antes do `os.replace`. Além disso:

- **Guarda**: só publica com `SITE_FTP_PUBLICAR=S` no `operacao.env` (o ambiente não a
  liga). Com outro valor, registra `publicacao desativada` e sai 0. O `--dry-run`
  funciona com a guarda desligada: conecta, lista o servidor e resume por grupo o que
  seria enviado, sem enviar nada.
- **Publicação certa**: o `completo` recusa `site/` se o `sitemap.xml` não apontar para
  `SITE_FTP_URL` (vazio: `https://SITE_FTP_HOST/`), porque `site/` também recebe o
  build das outras publicações, e recusa também se faltar `.htaccess`, `index.html` ou
  `assets/`.
- **Uma publicação por vez** (`flock` em `LOG_DIR/.site-ftp.lock`): as rotinas se
  encontram no minuto 5 e o `completo` demora. O `completo` espera a vez até 30 min e
  então falha; o `dados` espera até 4 min, menos que o ciclo do Céu, e desiste com
  código 0, deixando o envio para a execução seguinte. Cada fase tem um teto (3 h no
  `completo`, 15 min no `dados`), para um `lftp` travado não segurar a trava.
- **Senha**: vai ao `lftp` pela variável `LFTP_PASSWORD` (`--env-password`), nunca pela
  linha de comando, onde apareceria no `ps`, nem pelo arquivo de comandos, e nunca
  entra no log.

O log é `LOG_DIR/AAAAMMDD-site-ftp.log`, um só para as três origens: cada linha diz de
qual publicação é (`[completo]`, `[dados Ceu]`...). Código de saída: 0 = ok (inclusive
guarda desligada e `dados` sem vez), 1 = falha, 2 = uso incorreto.

### Cuidados conhecidos

- **FTP sem TLS.** O host não oferece `AUTH TLS`, então usuário, senha e arquivos
  trafegam em claro; o script não tenta TLS (`ftp:ssl-allow no`).
- **Sem `--delete`, o que sai de `site/` fica no servidor.** Um arquivo removido ou
  renomeado aqui (um dado que deixou de ser gerado, uma página retirada) tem de ser
  apagado à mão por FTP, e o `manifest.json` órfão de um rollback do pipeline também
  (ver [Deploy em produção](../../Architecture.md#deploy-em-produção)).
- **Envio que cai no meio não se refaz sozinho.** A cópia parcial no servidor fica com
  data mais nova que o arquivo local, e o `--only-newer` não a reenvia. Depois de uma
  fase com erro, dê `touch` nos arquivos locais afetados (ou em todos do diretório,
  `find site/<dir> -type f -exec touch {} +`) e publique de novo.
- **A rodada diária reenvia ~530 MB.** A cadeia do WRF regrava o `JSON/` inteiro
  (~7.300 arquivos) a cada rodada, então o `completo` manda tudo de novo; o resto sobe
  só quando muda.
- **O `.htaccess` ainda não desliga o `mod_pagespeed` do host**, que injeta scripts
  inline que a CSP bloqueia (ver
  [Deploy em produção](../../Architecture.md#deploy-em-produção)).

## Como a cópia da estação funciona

As tabelas do LoggerNet só crescem, então cada execução baixa apenas o que foi
acrescentado (`reget` do SFTP): alguns KB por vez, em vez das tabelas inteiras. Antes
de emendar, os últimos 8 KB da cópia local são baixados de novo e comparados; se não
batem, o logger trocou de arquivo e a tabela é baixada inteira. Uma tabela remota
menor que a local nunca sobrescreve a local: o erro fica no log. A última linha sem
fim de linha (o LoggerNet gravando durante a cópia) é descartada e vem inteira na
próxima vez. Sem registro novo, `data/` não é tocado; com registro novo, o arquivo
completo é montado ao lado e entra em `data/` por `mv` atômico.

## Logs e imagens

Cada rotina escreve em `LOG_DIR/AAAAMMDD-site-<rotina>.log` (a publicação, em
`AAAAMMDD-site-ftp.log`) e apaga os seus logs com mais de `LOG_DIAS` dias. As imagens da câmera **não** são apagadas por idade: ficam em
`ALLSKY_WATCH_DIR` para montar datasets, a ~0,6–1,3 GB/dia. Para isso o
`processa_site_ceu.sh` passa `--prune-frames-days 36500` (100 anos): sem a flag, o
`allsky publish-site` apaga a cada execução as imagens com mais de 14 dias, e a opção
não aceita 0 para desligar a limpeza. O próprio watch descarta as capturas repetidas do
mesmo horário.
