"use strict";

/**
 * Caminhos de dados operacionais: o que o deploy entrega e o git nunca vê.
 *
 * Há DUAS perguntas diferentes aqui, e trocá-las uma pela outra foi um bug real.
 *
 * `publicationOperationalPaths` responde "o que ESTA publicação declara". Serve
 * para validar a publicação e para descrevê-la — o robots.txt dela não deve
 * anunciar um diretório que o deploy dela nunca recebe.
 *
 * `allOperationalPaths` responde "o que é dado operacional NESTA árvore". É essa
 * que vale para empacotar e para varrer `site/`, porque `site/` é reconstruído no
 * mesmo lugar para cada publicação e os diretórios de dados NÃO são apagados entre
 * uma build e a seguinte: o `site/Climatologia/` da publicação anterior continua em
 * disco enquanto a próxima é empacotada. Derivar a exclusão só do dataset da
 * publicação corrente fazia `dist/ufes/` levar junto a climatologia e o
 * monitoramento da estação de Salvador — dados do acervo de sensores do
 * laboratório, que não são públicos, dentro do bundle de outra instituição.
 */

// Gráficos da estação: PNG reescritos no lugar pela própria estação meteorológica,
// com marca d'água gravada na imagem. São versionados para a publicação padrão, então
// embarcá-los no bundle de outra publicação publicaria a marca do laboratório errado.
const DEFAULT_GRAPHS_DIRECTORY = "assets/graphs";

/**
 * `includeGraphs` separa dois usos que não coincidem. Empacotar exclui os gráficos da
 * estação, senão o bundle de um laboratório sai com a marca d'água do outro. Já a
 * verificação de links precisa vê-los: os PNG são versionados, então um `src` com
 * typo em `dataset.observations` tem de quebrar o portão em vez de ser dispensado
 * como "dado que o deploy entrega".
 */
function publicationOperationalPaths(publication, { includeGraphs = true } = {}) {
  const {
    manifest,
    values,
    grids,
    climatology,
    monitoring,
    graphs = DEFAULT_GRAPHS_DIRECTORY,
  } = publication.dataset.paths;
  return {
    // `climatology` e `monitoring` são opcionais: só uma publicação que divulga o
    // registro da própria estação os declara.
    directories: [...new Set([values, grids, climatology, monitoring, includeGraphs ? graphs : null].filter(Boolean))],
    files: new Set([manifest].filter(Boolean)),
  };
}

function allOperationalPaths(publications, options) {
  const directories = new Set();
  const files = new Set();
  for (const publication of publications) {
    const declared = publicationOperationalPaths(publication, options);
    declared.directories.forEach((directory) => directories.add(directory));
    declared.files.forEach((file) => files.add(file));
  }
  return { directories: [...directories], files };
}

function isOperationalPath(relativePath, { directories, files }) {
  const normalized = String(relativePath).split("\\").join("/");
  if (files.has(normalized)) return true;
  return directories.some((directory) => normalized === directory || normalized.startsWith(`${directory}/`));
}

module.exports = {
  DEFAULT_GRAPHS_DIRECTORY,
  publicationOperationalPaths,
  allOperationalPaths,
  isOperationalPath,
};
