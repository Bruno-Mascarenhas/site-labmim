<!--
  Numerador de páginas em todos os slides (canto superior direito), no estilo do
  tema academic. O tema seriph não traz contador próprio.
  Slide 2 é o pôster de arquitetura full-bleed — lá o contador é omitido para não
  colidir com a legenda do desenho.
-->
<template>
  <div
    v-if="$slidev.nav.currentPage !== 2"
    class="slide-page-no"
  >
    {{ $slidev.nav.currentPage }} / {{ $slidev.nav.total }}
  </div>
</template>

<style scoped>
.slide-page-no {
  position: absolute;
  top: 0.75rem;
  right: 1.25rem;
  z-index: 20;
  font-size: 0.7rem;
  letter-spacing: 0.02em;
  opacity: 0.45;
  pointer-events: none;
}
</style>
