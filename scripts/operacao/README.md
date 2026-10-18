# Integração operacional do site

Os scripts desta pasta conectam o build estático aos produtos preparados pelo
laboratório. O build e os testes podem ser executados sem acesso à infraestrutura
do laboratório e sem cópia do acervo de produção.

## Responsabilidades

- O frontend valida e apresenta os produtos científicos recebidos.
- O produtor aplica os filtros científicos e prepara as saídas públicas.
- Os mantenedores administram a aquisição, a configuração e a publicação.

A documentação pública descreve a finalidade dos componentes. Procedimentos de
acesso a instrumentos, sincronização, credenciais, topologia de rede, comandos de
publicação e recuperação ficam em documentação interna fora dos repositórios.
Configurações locais e dados operacionais nunca entram em commits ou bundles.

## Estado da visualização

Kt × Kd usa uma amostra de até 5.000 pontos e no máximo 25% do conjunto. Densidade,
curvas e métricas conservam o registro completo. A climatologia publica os
recortes oferecidos na interface. O Monitoramento mantém sua resolução de
5 minutos e as ferramentas de diagnóstico; os CSVs de observações ficam
desabilitados. As figuras completas para artigos permanecem disponíveis aos
pesquisadores a partir de seu acervo local autorizado.

## Verificação local

Na raiz do repositório:

```bash
npm test
npm run test:server
bash -n scripts/operacao/publica_site_ftp.sh
```

Os testes de navegador usam fixtures artificiais. Os testes de servidor usam um
Apache temporário com acesso restrito à máquina local e não consultam produção.
As instruções de desenvolvimento estão em [CONTRIBUTING.md](../../CONTRIBUTING.md).
