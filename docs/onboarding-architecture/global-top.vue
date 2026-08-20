<!--
  Numerador de páginas em todos os slides. O tema seriph não traz contador próprio.
-->
<template>
  <div class="slide-page-no">
    {{ $slidev.nav.currentPage }} / {{ $slidev.nav.total }}
  </div>
</template>

<style scoped>
.slide-page-no {
  position: absolute;
  top: 0.8rem;
  right: 1.45rem;
  z-index: 20;
  font-family: "Inter", "DejaVu Sans", sans-serif;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  opacity: 0.5;
  pointer-events: none;
}
</style>

<style>
:root {
  --deck-navy: #101a2e;
  --deck-ink: #172238;
  --deck-muted: #58667a;
  --deck-paper: #f6f8fb;
  --deck-line: #d8e0ea;
  --deck-purple: #7254d8;
  --deck-blue: #2c73d2;
  --deck-teal: #198f86;
  --deck-orange: #d97832;
}

.slidev-layout {
  position: relative;
  padding: 2.4rem 3rem 2.1rem;
  background:
    linear-gradient(90deg, var(--deck-purple) 0 31%, var(--deck-blue) 31% 61%, var(--deck-teal) 61% 82%, var(--deck-orange) 82%) top / 100% 0.38rem no-repeat,
    var(--deck-paper);
  color: var(--deck-ink);
  font-family: "Inter", "DejaVu Sans", sans-serif;
  font-size: 1.02rem;
  line-height: 1.36;
}

.slidev-layout h1,
.slidev-layout h2,
.slidev-layout h3 {
  font-family: "Inter", "DejaVu Sans", sans-serif;
  color: var(--deck-navy);
  letter-spacing: -0.025em;
}

.slidev-layout h1 {
  margin: 0 0 1.15rem;
  font-size: 2rem;
  line-height: 1.08;
  font-weight: 800;
}

.slidev-layout h2 {
  font-size: 1.3rem;
  font-weight: 750;
}

.slidev-layout h3 {
  margin: 0 0 0.35rem;
  font-size: 1rem;
  font-weight: 750;
}

.slidev-layout p,
.slidev-layout li,
.slidev-layout td,
.slidev-layout th {
  color: var(--deck-ink);
}

.slidev-layout li.task-list-item {
  list-style: none;
}

.slidev-layout .opacity-70,
.slidev-layout .opacity-80 {
  color: var(--deck-muted);
  opacity: 1;
}

.slidev-layout pre,
.slidev-layout code {
  font-family: "DejaVu Sans Mono", "JetBrains Mono", monospace;
}

.slidev-layout pre {
  border: 1px solid #24314a;
  border-radius: 0.65rem;
  background: #0e1625 !important;
  box-shadow: none;
}

.slidev-layout :not(pre) > code {
  border-radius: 0.25rem;
  background: #e9eef6;
  color: #273a58;
  padding: 0.05em 0.3em;
}

.slidev-layout .border {
  border-color: var(--deck-line) !important;
  background: #fff;
  box-shadow: 0 1px 0 rgba(16, 26, 46, 0.04);
}

.slidev-layout table {
  width: 100%;
  border-collapse: collapse;
}

.slidev-layout th {
  background: #eef2f8;
  font-weight: 750;
}

.slidev-layout th,
.slidev-layout td {
  border-color: var(--deck-line);
}

.slidev-layout.deck-cover {
  background:
    radial-gradient(circle at 92% 8%, rgba(114, 84, 216, 0.92) 0 9%, transparent 9.2%),
    linear-gradient(145deg, #101a2e 0 72%, #172746 72% 100%);
  color: #fff;
}

.slidev-layout.deck-cover h1,
.slidev-layout.deck-cover h2,
.slidev-layout.deck-cover h3,
.slidev-layout.deck-cover p,
.slidev-layout.deck-cover li,
.slidev-layout.deck-cover th,
.slidev-layout.deck-cover td {
  color: #f7f9fc;
}

.slidev-layout.deck-cover h1 {
  margin-top: 1.1rem;
  font-size: 2.35rem;
}

.slidev-layout.deck-cover h2 {
  max-width: 95%;
  font-size: 1.55rem;
  line-height: 1.18;
}

.slidev-layout.deck-cover table {
  overflow: hidden;
  border-radius: 0.7rem;
  background: rgba(255, 255, 255, 0.06);
}

.slidev-layout.deck-cover th {
  background: rgba(114, 84, 216, 0.26);
}

.slidev-layout.deck-cover :not(pre) > code {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.deck-cover + .slide-page-no,
.slidev-layout.deck-cover ~ .slide-page-no {
  color: #fff;
}
</style>
