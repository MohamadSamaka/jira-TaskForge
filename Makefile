.PHONY: install dev test lint sync clean help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install taskforge in current environment
	pip install -e .

dev: ## Install with dev dependencies
	pip install -e ".[dev]"

test: ## Run tests with pytest
	pytest tests/ -v --tb=short

lint: ## Run basic lint checks
	python -m py_compile src/taskforge/cli/__init__.py
	python -m py_compile src/taskforge/config.py

sync: ## Run jira-assist sync
	jira-assist sync

clean: ## Remove build artifacts and caches
	rm -rf build/ dist/ *.egg-info src/*.egg-info
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
