.PHONY: help install lint lint-js lint-css format format-check ci

# Default target
help:
	@echo "Comandos disponíveis:"
	@echo "  make install       - Instala as dependências do Node (npm install)"
	@echo "  make lint          - Roda o linter de JS (ESLint) e CSS (Stylelint)"
	@echo "  make lint-js       - Roda apenas o linter de JS"
	@echo "  make lint-css      - Roda apenas o linter de CSS"
	@echo "  make format        - Formata o código fonte usando o Prettier (altera os arquivos)"
	@echo "  make format-check  - Verifica a formatação do código fonte (usado no CI)"
	@echo "  make ci            - Roda todos os testes do CI (lint e format-check)"

install:
	npm install

lint-js:
	npm run lint:js

lint-css:
	npm run lint:css

lint: lint-js lint-css

format:
	npm run format

format-check:
	npm run format:check

ci: format-check lint
