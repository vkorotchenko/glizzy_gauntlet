.DEFAULT_GOAL := help
SHELL := /bin/sh

ENV_FILE ?= .env
PROJECT ?= glizzy-gauntlet
PROD_PROJECT ?= glizzy-prod
MVN ?= ./mvnw
ARGS ?=
WORKFLOW ?= ci.yml
REF ?= $(shell git branch --show-current)
RUN_ID ?=
OPS_PROJECT ?=
BACKUP_DIR ?=

COMPOSE = docker compose --project-name "$(PROJECT)" --env-file "$(ENV_FILE)" -f infra/compose.yaml
LOCAL_COMPOSE = $(COMPOSE) -f infra/compose.dev.yaml
PROD_COMPOSE = docker compose --project-name "$(PROD_PROJECT)" --env-file "$(ENV_FILE)" -f infra/compose.yaml --profile public

.PHONY: help install dev watch dev-host dev-api build build-js build-api images \
	up down status logs check lint typecheck format api-generate api-check \
	test test-api browser-install test-e2e test-recovery ci preflight deploy \
	deploy-status deploy-logs backup restore ci-run ci-runs ci-watch ci-logs \
	ci-rerun require-backup-args require-run-id

help: ## Show available commands (the default target)
	@awk 'BEGIN { FS = ":.*## "; print "Glizzy Gauntlet commands:\n" } /^[a-zA-Z0-9_-]+:.*## / { printf "  %-20s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## Install locked Node dependencies
	npm ci

dev: ## Start Vite hot reload; requires the local Docker stack
	npm run watch

watch: dev ## Watch website changes with Vite hot reload at http://127.0.0.1:5173

dev-host: ## Start Vite and a host gateway; requires a host API
	npm run dev

dev-api: ## Start the host API with privately exported runtime configuration
	cd services/api && $(MVN) -B spring-boot:run

build: build-js build-api ## Build the Node applications and Java API

build-js: ## Build the web app, gateway, and API client
	npm run build

build-api: ## Package the Java API without running tests
	cd services/api && $(MVN) -B -DskipTests package

images: ## Build the local Docker application images
	$(LOCAL_COMPOSE) build

up: ## Build and start the local stack; wait for healthy services
	$(LOCAL_COMPOSE) up --build --detach --wait

down: ## Stop the local stack without deleting database or media volumes
	$(LOCAL_COMPOSE) down

status: ## Show local stack services
	$(LOCAL_COMPOSE) ps

logs: ## Follow local logs; optionally select services with ARGS
	$(LOCAL_COMPOSE) logs --follow --tail 100 $(ARGS)

check: ## Run Node lint, formatting, types, unit tests, and contract checks
	npm run check

lint: ## Lint TypeScript and JavaScript
	npm run lint

typecheck: ## Check all TypeScript projects
	npm run typecheck

format: ## Format Node sources, documentation, and Java
	npm run format
	cd services/api && $(MVN) -B spotless:apply

api-generate: ## Regenerate TypeScript types from the OpenAPI contract
	npm run api:generate

api-check: ## Check that generated API types are current
	npm run api:check

test: ## Run Node unit tests; pass runner flags with ARGS
	npm test -- $(ARGS)

test-api: ## Verify Java formatting and backend tests; requires Docker
	cd services/api && $(MVN) -B verify $(ARGS)

browser-install: ## Install Chromium; use ARGS=--with-deps on Linux CI
	npx --no-install playwright install $(ARGS) chromium

test-e2e: ## Run browser acceptance against an already-running local stack
	npm run test:e2e -- $(ARGS)

test-recovery: ## Rehearse recovery; requires explicit disposable-stack environment flags
	npm run test:recovery

ci: ## Run CI checks and builds without starting or deploying a stack
	$(MAKE) check
	$(MAKE) build-js
	$(MAKE) test-api

preflight: ## Check production configuration; does not certify external readiness
	npm run ops -- preflight --env-file "$(ENV_FILE)"

deploy: preflight ## Build and deploy the public stack only after preflight passes
	$(PROD_COMPOSE) up --build --detach --wait

deploy-status: ## Show production stack services
	$(PROD_COMPOSE) ps

deploy-logs: ## Follow production logs; optionally select services with ARGS
	$(PROD_COMPOSE) logs --follow --tail 100 $(ARGS)

require-backup-args:
	@test -n "$(OPS_PROJECT)" && test -n "$(BACKUP_DIR)" || { printf '%s\n' 'Set OPS_PROJECT and BACKUP_DIR explicitly; see ops/README.md.' >&2; exit 2; }

backup: require-backup-args ## Back up an explicit project to a new private BACKUP_DIR
	npm run ops -- backup --project "$(OPS_PROJECT)" --output "$(BACKUP_DIR)"

restore: require-backup-args ## Restore BACKUP_DIR into an explicit, empty OPS_PROJECT
	npm run ops -- restore --project "$(OPS_PROJECT)" --input "$(BACKUP_DIR)"

ci-run: ## Dispatch a GitHub Actions workflow for REF (default: current branch)
	@test -n "$(REF)" || { printf '%s\n' 'Set REF to the branch or tag to run.' >&2; exit 2; }
	gh workflow run "$(WORKFLOW)" --ref "$(REF)"

ci-runs: ## List recent GitHub Actions runs for REF
	gh run list --workflow "$(WORKFLOW)" --branch "$(REF)" --limit 10

require-run-id:
	@test -n "$(RUN_ID)" || { printf '%s\n' 'Set RUN_ID to an explicit GitHub Actions run ID.' >&2; exit 2; }

ci-watch: require-run-id ## Wait for RUN_ID and fail if the workflow fails
	gh run watch "$(RUN_ID)" --exit-status

ci-logs: require-run-id ## Show failed-job logs for RUN_ID
	gh run view "$(RUN_ID)" --log-failed

ci-rerun: require-run-id ## Rerun failed jobs in RUN_ID
	gh run rerun "$(RUN_ID)" --failed
