.PHONY: help install build build-check lint lint-js lint-css lint-html lint-links format format-check fix audit serve ci

# Default target
help:
	@echo "Comandos disponíveis:"
	@echo "  make install       - Instala as dependências do Node (npm install)"
	@echo "  make build         - Gera as páginas HTML estáticas a partir de src/ (partials + build.js)"
	@echo "  make build-check   - Gera e verifica se site/*.html está atualizado (usado no CI)"
	@echo "  make lint          - Roda o linter de JS (ESLint) e CSS (Stylelint), sem alterar arquivos"
	@echo "  make lint-js       - Roda apenas o linter de JS"
	@echo "  make lint-css      - Roda apenas o linter de CSS"
	@echo "  make format        - Formata o código fonte usando o Prettier (altera os arquivos)"
	@echo "  make format-check  - Verifica a formatação do código fonte (usado no CI)"
	@echo "  make fix           - Aplica automaticamente as correções do Prettier e dos linters"
	@echo "  make audit         - Verifica vulnerabilidades nas dependências (npm audit)"
	@echo "  make serve         - Serve o site localmente em http://localhost:8000"
	@echo "  make lint-html     - Valida o HTML gerado (html-validate)"
	@echo "  make lint-links    - Verifica links/assets internos (linkinator)"
	@echo "  make ci            - Roda todos os checks do CI (build-check, format-check, lint, html, links, audit)"

install:
	npm install

build:
	npm run build

build-check:
	npm run build:check

lint-js:
	npm run lint:js

lint-css:
	npm run lint:css

lint-html:
	npm run lint:html

lint-links:
	npm run lint:links

lint: lint-js lint-css

format:
	npm run format

format-check:
	npm run format:check

fix:
	npm run format
	npm run lint:js -- --fix
	npm run lint:css -- --fix

audit:
	npm audit --audit-level=high

serve:
	python3 -m http.server 8000 --directory site

ci: build-check format-check lint lint-html lint-links audit
