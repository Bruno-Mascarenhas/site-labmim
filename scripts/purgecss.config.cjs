/**
 * Configuração do PurgeCSS para gerar
 * assets/vendor/bootstrap/bootstrap.purged.min.css a partir do
 * bootstrap.min.css completo (que permanece vendorizado ao lado).
 *
 * Regenerar (após mudar classes Bootstrap no HTML/JS):
 *   npm run build   # o conteúdo analisado é o HTML GERADO em site/
 *   npx purgecss --config scripts/purgecss.config.cjs \
 *     --output site/assets/vendor/bootstrap/
 *   mv site/assets/vendor/bootstrap/bootstrap.min.css \
 *      site/assets/vendor/bootstrap/bootstrap.purged.min.css  # se necessário
 *
 * O check `npm run lint:purge` (scripts/check-bootstrap-purge.mjs) falha se
 * uma classe Bootstrap nova aparecer no site sem regra no arquivo purgado.
 *
 * A safelist cobre as classes que os plugins JS do Bootstrap alternam em
 * runtime (só collapse e modal são usados no site) e estados genéricos.
 */
module.exports = {
  content: ["site/*.html", "site/assets/js/**/*.js"],
  css: ["site/assets/vendor/bootstrap/bootstrap.min.css"],
  // Não remover variáveis --bs-* nem @keyframes (spinner-border é usado nos
  // overlays de carregamento dos mapas).
  variables: false,
  keyframes: false,
  fontFace: false,
  safelist: {
    standard: [
      // Bootstrap Collapse (navbar)
      "collapse",
      "collapsing",
      "collapse-horizontal",
      "show",
      "showing",
      "hiding",
      "fade",
      // Bootstrap Modal (página de monitoramento)
      "modal-open",
      "modal-backdrop",
      "modal-static",
      // Estados genéricos alternados em runtime
      "active",
      "disabled",
    ],
    deep: [],
    greedy: [],
  },
};
