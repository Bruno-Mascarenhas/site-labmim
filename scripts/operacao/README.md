# Operação: os dados do site no servidor

O build gera o código do site. Os dados que as páginas buscam em tempo de execução
(`JSON/`, `GeoJSON/`, `Climatologia/`, `Monitoramento/`, `Ceu/`) vêm do
[micrometeorology](https://github.com/Bruno-Mascarenhas/micrometeorology) e são
depositados dentro de `site/`, onde o git só guarda o `.keep`
(ver [De onde vêm os dados](../../README.md#de-onde-vêm-os-dados)). As rotinas desta
pasta mantêm esses dados frescos no servidor de operação da LabMiM/UFBA; depois delas
só falta publicar `site/` por FTP, na ordem de
[Deploy em produção](../../Architecture.md#deploy-em-produção).

## Quem gera o quê

| Cadência                  | Rotina                                           | Escreve em `site/`                                               |
| ------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| 1×/dia, após a rodada WRF | cadeia do WRF: `mm-wrf-geojson`, `mm-wrf-series` | `JSON/`, `GeoJSON/` (e a série operacional, fora de `site/`)     |
| 1×/dia, após a série      | [acervo, climatologia e Kt × Kd](#rotina-diária) | `Climatologia/`, `Ceu/ktkd*.json`, `Ceu/kt_cumulative.json`      |
| de hora em hora           | `processa_site_monitoramento.sh`                 | `Monitoramento/monitoring.json`                                  |
| a cada 5 min              | `processa_site_ceu.sh`                           | `Ceu/frame.json`, `Ceu/timeline.json`, `Ceu/model.json`, imagens |
| contínuo                  | `allsky-watch.service` (`allsky-watch.sh`)       | nada: imagens da câmera e previsões em `ALLSKY_WATCH_DIR`        |

As duas rotinas do cron começam por `sincroniza_sensores_lbm.sh`, que traz do PC da
estação o que o datalogger acrescentou às tabelas. Início e Equipe são estáticas.

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
2. **Configuração**: `cp operacao.env.example operacao.env` e ajuste. O `operacao.env`
   fica fora do git: ele nomeia a máquina e o usuário da estação.
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

6. **cron**:

   ```cron
   5 * * * *   /caminho/para/site-labmim/scripts/operacao/processa_site_monitoramento.sh
   */5 * * * * /caminho/para/site-labmim/scripts/operacao/processa_site_ceu.sh
   ```

   O `processa_site_ceu.sh` faz o papel do `allsky-publish.timer` do
   micrometeorology: não habilite os dois, que escreveriam no mesmo `Ceu/`.

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

Cada rotina escreve em `LOG_DIR/AAAAMMDD-site-<rotina>.log` e apaga os seus logs com
mais de `LOG_DIAS` dias. As imagens da câmera **não** são apagadas por idade
(`processa_site_ceu.sh` roda sem `--prune-frames-days`): ficam para montar datasets,
a ~0,6–1,3 GB/dia. O próprio watch descarta as capturas repetidas do mesmo horário.
