# LabMiM Site Architecture

Este documento descreve a arquitetura atual do site LabMiM com base no estado real do repositório. Ele deve ser usado como referência para manutenção, evolução do WebGIS e prevenção de regressões.

## Visão Geral

O projeto é um site estático em `site/`, composto por HTML, CSS modular e JavaScript sem framework frontend. O WebGIS usa Leaflet com renderização em Canvas para exibir grades meteorológicas e potenciais energéticos, carregando dados WRF a partir de arquivos gerados em `GeoJSON/` e `JSON/`.

Não há backend de aplicação neste repositório. Qualquer atualização de dados depende de pipeline externo que gere os arquivos consumidos pelo frontend.

## Páginas HTML

| Arquivo                            | Função                                                      |
| ---------------------------------- | ----------------------------------------------------------- |
| `site/index.html`                  | Página inicial institucional                                |
| `site/monitoring.html`             | Monitoramento ambiental com gráficos PNG e modais Bootstrap |
| `site/team.html`                   | Equipe, links e localização incorporada                     |
| `site/climatologia.html`           | Página de climatologia em construção                        |
| `site/mapas_interativos.html`      | WebGIS de previsões meteorológicas                          |
| `site/potenciais_energeticos.html` | WebGIS de potencial fotovoltaico e potencial eólico         |
| `site/mapas_meteorologicos.html`   | Redirect de compatibilidade para `mapas_interativos.html`   |

As páginas institucionais usam Bootstrap 4.1.3. `mapas_interativos.html` e `potenciais_energeticos.html` usam Bootstrap 5.3.0 por CDN.

A navbar principal segue a ordem: Previsões, Potenciais Energéticos, Monitoramento, Climatologia e Equipe.

## Organização De Pastas

```text
site/
├── assets/
│   ├── css/
│   │   ├── base.css
│   │   ├── layout.css
│   │   ├── components.css
│   │   ├── theme.css
│   │   └── maps.css
│   ├── js/
│   │   ├── theme-boot.js
│   │   ├── theme-toggle.js
│   │   ├── ui-shell.js
│   │   ├── variables-config.js
│   │   ├── charts-manager.js
│   │   ├── map-manager.js
│   │   ├── map-init.js
│   │   └── workers/
│   │       ├── color-calc.worker.js
│   │       └── json-parser.worker.js
│   ├── graphs/
│   ├── icon/
│   ├── img/
│   └── json/
├── GeoJSON/
└── JSON/
```

Observações:

- `assets/graphs/` contém PNGs usados em `monitoring.html`.
- `assets/img/` contém logos e imagens institucionais.
- `assets/icon/` contém ícones raster usados em menus.
- `assets/json/` está reservado para manifestos opcionais; atualmente há apenas marcador de pasta.
- `GeoJSON/` e `JSON/` contêm dados gerados. Há também arquivos GeoJSON específicos por variável presentes na pasta, mas o código atual do mapa carrega `GeoJSON/{domain}.geojson`.
- Não abra, varra, formate ou reprocesse `/data`; evite ler conteúdo de `GeoJSON/` e `JSON/` fora de depuração estritamente necessária, porque esses diretórios podem conter artefatos grandes do pipeline externo.

## CSS

### Responsabilidades

| Arquivo          | Responsabilidade                                                                    |
| ---------------- | ----------------------------------------------------------------------------------- |
| `base.css`       | Tokens CSS, reset, tipografia, utilitários pequenos, logos e cores base             |
| `layout.css`     | Navbar, seções de página, footer e estrutura compartilhada                          |
| `components.css` | Cards, parceiros, financiadores, blocos de explicação, monitoramento, modal helpers |
| `theme.css`      | Dark mode, overrides de tema, estados de controles, ajustes globais de contraste    |
| `maps.css`       | Layout e componentes exclusivos do WebGIS                                           |

### Padrões

- Use variáveis CSS em `:root` para cores, sombras, bordas e espaçamentos globais.
- Dark mode é controlado pela classe `.dark-theme` no elemento `<html>`.
- `maps.css` é carregado depois de `theme.css` nas páginas WebGIS; quando um estilo escuro precisa vencer regras do mapa, o override deve estar em `maps.css` ou ter especificidade compatível.
- Evite estilos inline. Crie classes reutilizáveis em `components.css` ou `maps.css`, conforme o escopo.
- Mantenha responsividade com media queries já existentes; não use escala tipográfica baseada diretamente em viewport.

## JavaScript

### Módulos Gerais

| Arquivo           | Responsabilidade                                                                       |
| ----------------- | -------------------------------------------------------------------------------------- |
| `theme-boot.js`   | Aplica `.dark-theme` cedo com base em `localStorage` ou preferência do sistema         |
| `theme-toggle.js` | Controla botões de tema, ícones, `aria-*`, persistência e evento `labmim-theme-change` |
| `ui-shell.js`     | Toggle genérico para pequenos blocos de UI em páginas institucionais                   |

### Módulos Do WebGIS

| Arquivo                         | Responsabilidade                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `variables-config.js`           | Define `VARIABLES_CONFIG`, `VARIABLE_CONTEXTS`, IDs de arquivo, unidades, palhetas e `specificInfo()` por variável |
| `map-manager.js`                | Classe `MeteoMapManager`; estado do mapa, domínio, dados, renderização, controles e vento                          |
| `charts-manager.js`             | Classe `ChartsManager`; séries temporais, Chart.js, modal, cache e CSV                                             |
| `map-init.js`                   | Bootstrap do WebGIS; cria `MeteoMapManager`, cria `ChartsManager` e conecta sidebar/modal                          |
| `workers/color-calc.worker.js`  | Interpolação de cores fora da thread principal                                                                     |
| `workers/json-parser.worker.js` | Fetch/parse JSON em worker quando disponível                                                                       |

`MeteoMapManager` e `ChartsManager` são expostos em `window` para preservar compatibilidade do bootstrap atual.

## Dark Mode

Fluxo atual:

1. `theme-boot.js` roda no `<head>`.
2. Ele lê `localStorage.getItem("labmim-theme")`.
3. Se o valor for `dark`, ou se não houver valor e o sistema preferir dark, aplica `.dark-theme`.
4. `theme-toggle.js` inicializa no `DOMContentLoaded`, atualiza ícones e atributos acessíveis.
5. Ao alternar tema, `theme-toggle.js` salva `labmim-theme` e dispara `labmim-theme-change`.
6. `ChartsManager` escuta esse evento e chama `refreshChartTheme()`.

Cuidados:

- Não remova `theme-boot.js`; ele reduz flash visual antes do carregamento do JS deferido.
- Se criar novos componentes com fundo próprio em `maps.css`, crie também o equivalente para `.dark-theme` quando necessário.
- Valide títulos de modal/sidebar em dark mode, porque `maps.css` é carregado por último na página de mapas.

## Arquitetura Dos Mapas Interativos

### Inicialização

`map-init.js` roda após `DOMContentLoaded`:

```js
app = new MeteoMapManager();
chartsManager = new ChartsManager(app);
app.chartsManager = chartsManager;
```

Depois ele envolve `app.showSidebar()` para abrir o modal de séries temporais e carregar dados do ponto selecionado.

### Estado Principal

`MeteoMapManager` lê `data-map-context` no `<body>` para separar os contextos `forecast` e `energy`. `mapas_interativos.html` inicia apenas com variáveis meteorológicas; `potenciais_energeticos.html` inicia apenas com potencial fotovoltaico e potencial eólico.

`MeteoMapManager` mantém estado interno em `this.state`, incluindo:

- `domain`
- `type`
- `index`
- `maxLayer`
- `isPlaying`
- `intervalId`
- `selectedCell`
- `selectedHeight`
- `isClippedToState`

Elementos de DOM usados com frequência são cacheados em `this.ui`.

### Domínios

`DOMAIN_CONFIG` separa o ID técnico do label exibido. Os IDs técnicos continuam sendo usados nos nomes de arquivos, cache e estado:

- `D01` -> label `BA/NE`
- `D02` -> label `BA`
- `D03` -> label `RMS`
- `D04` -> label `SSA`

Os botões `.domain-btn` atualizam `this.state.domain`, limpam cache de grade e recarregam dados. O domínio não troca automaticamente por zoom; a troca é manual.

### Carregamento De Dados

O fluxo principal é:

1. `applyMapChanges()`
2. `loadValueData(index, type)`
3. `getVariableId(type)`
4. Fetch de `JSON/{domain}_{variableId}_{index}.json`
5. `loadGridLayer(domain)`
6. Fetch de `GeoJSON/{domain}.geojson`
7. `applyValuesToGrid(gridLayer, valueData)`
8. `showGeoJsonLayer(gridLayer)`
9. `updateUIFromMetadata(metadata)`

`_cachedFetch()` usa cache em memória (`_jsonCache`) com limite definido por `JSON_CACHE_LIMIT`. Quando possível, o fetch/parse usa `json-parser.worker.js`.

### Contratos De Dados

#### Grade

O código atual espera:

```text
GeoJSON/{domain}.geojson
```

Exemplo:

```json
{
  "type": "FeatureCollection",
  "metadata": {},
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [] },
      "properties": { "linear_index": 0 }
    }
  ]
}
```

`linear_index` é usado para alinhar célula e valor.

#### Valores

```text
JSON/{domain}_{variableId}_{hour:03d}.json
```

Exemplo:

```json
{
  "metadata": {
    "scale_values": [0, 1, 2],
    "date_time": "01/01/2024 12:00:00"
  },
  "values": [0.5, 1.2, null]
}
```

#### Vetores De Vento

```text
JSON/{domain}_WIND_VECTORS_{hour:03d}.json
```

Campos esperados:

- `downsampled_angles`
- `downsampled_magnitudes`
- `downsampled_linear_indices`

### Variáveis E Palhetas

As variáveis ficam em `VARIABLES_CONFIG`:

| Chave         | ID principal     | Observação                                             |
| ------------- | ---------------- | ------------------------------------------------------ |
| `solar`       | `SWDOWN`         | Possui regra para pular horários noturnos              |
| `eolico`      | `POT_EOLICO_50M` | Também define `id_100m`, `id_150m` e seletor de altura |
| `temperature` | `TEMP`           | Informações térmicas                                   |
| `pressure`    | `PRES`           | Usa escala dinâmica                                    |
| `humidity`    | `VAPOR`          | Umidade relativa                                       |
| `rain`        | `RAIN`           | Precipitação                                           |
| `wind`        | `WIND`           | Vento a 10m                                            |
| `hfx`         | `HFX`            | Calor sensível                                         |
| `lh`          | `LH`             | Calor latente                                          |

Cada entrada define:

- `id`
- `label`
- `unit`
- `colors`
- `specificInfo(value, allValues)`

Algumas entradas têm campos adicionais, como `useDynamicScale`, `normalValue`, `id_100m` e `id_150m`.

## Play/Pause E Loop Temporal

O controle principal é `#playPauseBtn`.

Fluxo:

- Clique chama `togglePlayPause()`.
- `setPlaybackState(true)` chama `startAnimation()`.
- `startAnimation()` cria `setInterval()` com `PLAYBACK_INTERVAL_MS`.
- A cada tick, incrementa `#layerSlider`, dispara evento `input` e carrega o novo horário.
- Ao passar de `maxLayer`, volta para `1`.
- Para `SWDOWN`, a lógica pula horários fora do intervalo solar e reinicia em `7`.

Não existe botão de loop separado na UI atual; o comportamento de loop é integrado à animação.

## Wind Layer Toggle

`windLayerToggle` é controlado por `updateVariableSpecificControls(variableType)`:

- Visível quando `variableType === "eolico"` ou `variableType === "wind"`.
- Oculto nas demais variáveis.
- O checkbox `#windLayerCheckbox` chama `toggleWindLayer(isEnabled)`.
- Quando ativo, `renderWindVectors()` busca `JSON/{domain}_WIND_VECTORS_{hour}.json` e desenha setas no canvas `#windVectorCanvas`.

Cuidados:

- Não exibir a camada de vento para variáveis que não sejam vento/eólico sem revisar UX e performance.
- `clearWindVectors()` também invalida requisições pendentes por `_windRequestKey`.

## Sidebar E Modal De Séries Temporais

Ao clicar em uma célula:

1. `handleMapClick()` identifica a célula Leaflet.
2. Carrega valores auxiliares via `loadAllVariableValuesForCell()`.
3. Atualiza `this.state.selectedCell`.
4. Chama `showSidebar()`.
5. `map-init.js` intercepta `showSidebar()` e abre o modal persistente de séries temporais.

`ChartsManager`:

- Carrega a série por lotes (`BATCH_SIZE = 12`).
- Usa `AbortController` para cancelar carregamentos anteriores.
- Mantém cache em `timeSeriesCache`.
- Reutiliza instâncias Chart.js com `.update("none")`.
- Exporta CSV com data, hora, latitude, longitude, variável e valores.

Para `solar` e `eolico`, o modal também exibe uma série derivada de energia.

## Componentes Compartilhados

- Navbar e footer: `layout.css`.
- Cards e seções institucionais: `components.css`.
- Parceiros e financiadores: classes `.partners-section`, `.partners-grid`, `.partner-logo`, `.sponsors-strip`.
- Toggle de explicação em `monitoring.html`: `ui-shell.js` via atributos `data-ui-toggle`.

## Dependências Externas

Runtime via CDN:

- Bootstrap 4.1.3 nas páginas institucionais.
- Bootstrap 5.3.0 na página de mapas.
- Font Awesome 6.4.0.
- Leaflet 1.9.4.
- Turf 6.
- Chart.js 3.9.1.

Dev tooling:

- ESLint 9.
- Stylelint 16.
- Prettier 3.

## Decisões Da Refatoração

- CSS antigo (`template.css`, `style.css`, `modern.css`, `custom-themes.css`) foi substituído por módulos menores e explícitos.
- Código legado de vídeos (`script-mapas.js`, `video.js`, `assets/video/`) foi removido.
- `mapas_meteorologicos.html` foi preservado como redirect de compatibilidade.
- Dark mode foi separado em bootstrap inicial (`theme-boot.js`) e controle interativo (`theme-toggle.js`).
- WebGIS mantém classes globais (`window.MeteoMapManager`, `window.ChartsManager`) para compatibilidade com o bootstrap atual.
- O mapa usa Canvas renderer do Leaflet para reduzir custo de renderização de grades.
- A interpolação de cores pode rodar em worker e ignora respostas obsoletas por `requestId`.

## Pontos De Extensão

### Adicionar Variável

1. Garantir arquivos em `JSON/{domain}_{variableId}_{hour}.json`.
2. Adicionar entrada em `VARIABLES_CONFIG`.
3. Associar a variável ao contexto correto em `VARIABLE_CONTEXTS`.
4. Atualizar o fallback do `<select id="variableSelect">` nas páginas WebGIS, se necessário.
5. Definir palheta, unidade e `specificInfo()`.
6. Validar sidebar, colorbar, séries temporais e dark mode.

### Alterar Palheta

Atualize `colors` da variável em `variables-config.js`. Se a variável usa escala dinâmica, revise também `normalValue` e `useDynamicScale`.

### Alterar Layout Institucional

Use os módulos CSS compartilhados. Evite criar regras específicas no HTML.

### Evoluir O WebGIS

O próximo passo arquitetural natural seria dividir `map-manager.js` em módulos menores. Isso deve ser feito com testes manuais cuidadosos porque o arquivo concentra estado, eventos, cache, renderização e sidebar.

## Cuidados Para Evitar Regressões

- Preserve os IDs usados pelo JS nas páginas WebGIS: `map`, `layerSlider`, `playPauseBtn`, `variableSelect`, `windLayerToggle`, `windLayerCheckbox`, `sidebar`, `sidebarContent`, `timeSeriesModal`, `chartCanvasValue`, `chartCanvasEnergy`.
- Não altere nomes de chaves em `VARIABLES_CONFIG` sem revisar dados, select HTML, gráficos e sidebar.
- Não renomeie os IDs técnicos `D01-D04`; eles fazem parte do contrato dos arquivos. Altere apenas labels públicos quando necessário.
- A variável `humidity` deve aparecer como "Umidade Específica" e usar unidade `kg/kg` enquanto o produto `VAPOR` continuar sem conversão no frontend.
- Não remova `theme-boot.js` do `<head>`.
- Ao mexer em `maps.css`, valide light e dark mode.
- Ao mexer em `map-manager.js`, valide play/pause, troca de domínio, troca de variável, clique em célula e wind layer.
- Ao mexer em `charts-manager.js`, valide carregamento, cancelamento, troca de tema e exportação CSV.
- Não documente dados ou endpoints que não existam no código. Se um novo pipeline mudar contratos de arquivo, atualize este documento junto.

## Checklist De Validação

Use antes de merge/publicação:

- `npm run format:check`
- `npm run lint:css`
- `npm run lint:js`
- Servir `site/` por HTTP local.
- Abrir páginas institucionais em desktop e mobile.
- Alternar dark mode em cada página.
- Abrir `mapas_interativos.html` e confirmar que variáveis energéticas não aparecem como previsões meteorológicas.
- Abrir `potenciais_energeticos.html` e confirmar Potencial Fotovoltaico e Potencial Eólico.
- Verificar se Leaflet renderiza e se não há erros no console.
- Trocar variáveis e domínios.
- Confirmar labels de domínio `BA/NE`, `BA`, `RMS` e `SSA` na UI, mantendo requisições internas com `D01-D04`.
- Testar play/pause até passar do final da escala temporal.
- Confirmar regra solar para horários noturnos.
- Ativar `windLayerToggle` em `wind` e `eolico`.
- Confirmar que `windLayerToggle` fica oculto nas demais variáveis.
- Clicar em uma célula e validar sidebar.
- Validar modal de séries temporais e exportação CSV.
