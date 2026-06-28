# AI Credential Library

Status: done
Updated: 2026-06-29

## Why Now

The current connector credential dialog creates a real `ai_credentials` row inline, then binds it to one connector or upstream pool. That works for simple cases, but DeepSeek-style providers with multiple compatible connectors need one reusable credential that can be referenced by more than one connector.

## Goal

Admins can manage AI credentials from a standalone page and bind existing credentials into connector credential pools without re-entering the secret.

## Key Path

1. Expose and consume enough credential and assignment data to show reuse state.
2. Add the standalone AI credentials page and navigation entry.
3. Update connector credential pool add flow to choose an existing credential or create a new one.
4. Verify duplicate-key fallback, existing connectivity tests, and type safety.

## Acceptance

- A standalone admin page lists AI credentials with supplier, owner, enabled state, prefix, usage count, last use, and bindings.
- Connector credential pool add dialog supports selecting an existing same-supplier credential.
- Existing "new credential" behavior still works.
- Binding still uses `ai_endpoint_credentials`, so weight and enabled state remain connector-local.
- Tests cover repeated real credentials and existing credential binding.

## Current Tasks

- [AI credential library and reusable bindings](../tasks/task-ai-credential-library.md)

## Execution Log

- 2026-06-29: Created project plan from current repo state. Existing `ai_credentials` / `ai_endpoint_credentials` schema already supports reusable bindings; primary work is API consumption and frontend flow.
- 2026-06-29: Implemented the standalone `/admin/ai-credentials` route, sidebar entry, credential CRUD hooks, full assignment query hook, connector dialog reuse flow, duplicate assignment guard, and focused API tests.
- 2026-06-29: Verified with focused unit tests, `pnpm typecheck`, `pnpm lint`, and `git diff --check`.
