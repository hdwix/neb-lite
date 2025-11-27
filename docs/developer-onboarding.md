# Developer onboarding and conventions

This guide is the starting point for engineers joining Nebengjek. It summarizes how the codebase is organized, which conventions we follow, and the habits that keep contributions consistent and safe to deploy.

## Project orientation
- **Stack:** NestJS 11 (TypeScript), TypeORM, BullMQ for queues, Redis, PostgreSQL/MySQL, Jest for testing.
- **Structure:** A monolithic Nest app with feature modules under `src/`, backed by background workers and Redis queues. Domain-specific logic should live in the module that owns the concept.
- **APIs:** Gateway HTTP endpoints (see `docs/nebengjek.postman_collection.json`) plus background processors that coordinate rides and notifications.

## Local setup
1. Install Node.js 20+ and npm.
2. Install dependencies: `npm install`.
3. Copy environment variables from team secrets and populate a local `.env` file. Required keys are listed in the root `README.md`.
4. Start the app locally with `npm run start:dev`.
5. Run quality checks before committing:
   - Lint: `npm run lint`
   - Unit tests: `npm test`
   - Coverage (if changing critical flows): `npm run test:cov`

## Coding conventions
- **TypeScript & NestJS style**
  - Prefer explicit return types on public functions and DTOs.
  - Keep controllers thin; push business logic into services.
  - Use Nest decorators for validation (`class-validator`) on DTOs and enforce transformations with `class-transformer`.
  - Avoid `any`; prefer discriminated unions or enums for explicit states.
- **Module boundaries**
  - Place feature-only enums and constants inside the module (`src/<feature>/constants` or `domain/constants`). Shared vocabulary belongs in `src/app/enums`; see `docs/enum-organization.md` for placement rules.
  - Cross-module services should depend on interfaces, not concrete implementations, to keep domains decoupled.
- **Error handling**
  - Throw Nest HTTP exceptions (`BadRequestException`, `ForbiddenException`, etc.) from controllers for request-level errors.
  - Services should raise domain-specific errors; translate them at the edges to HTTP exceptions.
  - Avoid swallowing errors; log with context and rethrow when appropriate.
- **Logging**
  - Use the configured logger (Pino via `nestjs-pino`) instead of `console.log`.
  - Include identifiers (rideId, driverId, userId, jobId) to make traces searchable.
- **Asynchrony & queues**
  - Keep BullMQ jobs idempotent. Guard against duplicate deliveries and retries.
  - Validate payloads before enqueueing; store persistence changes with the job to avoid orphan work.
- **Database & persistence**
  - Keep entity definitions close to their domain. Align enum-backed columns with the owning enum.
  - Prefer transactions for write flows that span multiple tables or publish outbox events.

## Testing discipline
- Write unit tests for services and utilities; use `@nestjs/testing` to stand up modules when necessary.
- Favor fast, deterministic tests. Mock external calls (HTTP, Redis, BullMQ) rather than hitting real services.
- When adding endpoints, include request validation and happy-path/edge-case tests under `test/` with descriptive names.

## API and DTO hygiene
- Version URLs under `/gateway/v1/...` and avoid breaking changes in existing paths.
- Validate all inbound DTOs with `class-validator`; mark optional fields explicitly.
- Document any new endpoints in the Postman collection (`docs/nebengjek.postman_collection.json`).

## Git workflow expectations
- Keep commits focused and message them in the imperative mood (e.g., "Add ride acceptance validation").
- Re-run lint and tests before pushing. Avoid committing generated files.
- When touching shared contracts (DTOs, enums), notify downstream consumers and update related docs.

## Security & secrets
- Never commit secrets. Use environment variables and keep `.env` files out of version control.
- Sanitize logs to avoid leaking tokens, OTP codes, or PII.

## When in doubt
- Search for prior art in the codebase before introducing new patterns.
- If a change crosses module boundaries, add a short ADR or doc note in `docs/` to explain the decision.
- Keep this guide updated whenever conventions evolve so future teammates can onboard quickly.
