# TaskFlow Backend

REST and WebSocket API for the TaskFlow Android app — a team task manager
(workspaces → boards → tasks → comments) with offline sync, live updates and push
notifications.

The backend is the single trusted source of data: it authenticates users, enforces
permissions, stores everything in PostgreSQL, detects conflicting edits from offline
devices, streams changes to connected clients and sends push notifications.

**Stack:** Node.js · TypeScript (strict, ESM) · Fastify · Zod · Prisma · PostgreSQL 16

---

## Quick start

You need Node.js 20.19+ (Active LTS recommended) and Docker. Nothing else, and no paid
accounts. Docker is required for the integration tests, which start their own PostgreSQL.

```bash
cp .env.example .env         # then set JWT_SECRET to 32+ random characters
docker compose up -d         # PostgreSQL 16 on localhost:5432
npm install
npm run db:migrate           # applies migrations and generates the Prisma client
npm run dev                  # http://localhost:8080
```

Check it is alive:

```bash
curl http://localhost:8080/api/v1/health
# {"status":"UP","database":"UP","version":"1.0.0"}
```

API documentation (Swagger UI): <http://localhost:8080/docs>

### Connecting from the Android emulator

The emulator reaches the host machine at `10.0.2.2`, not `localhost`:

```
http://10.0.2.2:8080/api/v1
```

The server listens on `0.0.0.0:8080` by default, so no extra configuration is needed.
Android blocks cleartext traffic by default — permit it for `10.0.2.2` in the debug
network security config, or use the HTTPS staging URL.

---

## npm scripts

| Script                                    | Does                                                               |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                             | Start with file watching (`tsx watch src/server.ts`)               |
| `npm run build`                           | Generate the Prisma client and compile to `dist/`                  |
| `npm start`                               | Run the compiled server (`node dist/server.js`)                    |
| `npm run typecheck`                       | `tsc --noEmit`                                                     |
| `npm run lint` / `npm run lint:fix`       | ESLint                                                             |
| `npm run format` / `npm run format:check` | Prettier                                                           |
| `npm test`                                | Full suite (integration tests start PostgreSQL via Testcontainers) |
| `npm run test:no-db`                      | The subset that runs without Docker                                |
| `npm run test:coverage`                   | Suite plus coverage report                                         |
| `npm run db:migrate`                      | `prisma migrate dev`                                               |
| `npm run db:migrate:deploy`               | `prisma migrate deploy` (production / containers)                  |
| `npm run db:seed`                         | Seed users, workspaces and tasks                                   |
| `npm run openapi:export`                  | Write the generated OpenAPI document to `openapi.yaml`             |

---

## Environment variables

Every variable is validated with Zod at startup. The server refuses to start if one is
missing or invalid and prints exactly which one. See `.env.example` for the full list
with comments.

| Variable                      | Default                         | Notes                                                 |
| ----------------------------- | ------------------------------- | ----------------------------------------------------- |
| `NODE_ENV`                    | `development`                   | `development` \| `test` \| `production`               |
| `PORT`                        | `8080`                          | Keeps the emulator URL at `http://10.0.2.2:8080`      |
| `HOST`                        | `0.0.0.0`                       | Must not be `127.0.0.1` for the emulator to reach it  |
| `LOG_LEVEL`                   | `info`                          | Pino level                                            |
| `DATABASE_URL`                | —                               | **Required**                                          |
| `JWT_SECRET`                  | —                               | **Required**, at least 32 characters                  |
| `JWT_ISSUER` / `JWT_AUDIENCE` | `taskflow` / `taskflow-android` | JWT claims                                            |
| `ACCESS_TOKEN_TTL_MINUTES`    | `15`                            | Access token lifetime                                 |
| `REFRESH_TOKEN_TTL_DAYS`      | `30`                            | Refresh token lifetime                                |
| `STORAGE_BUCKET` and friends  | empty                           | Empty means local disk under `STORAGE_LOCAL_DIR`      |
| `FIREBASE_CREDENTIALS_JSON`   | empty                           | Empty means push payloads are only logged             |
| `CORS_ALLOWED_ORIGINS`        | empty                           | Comma-separated; empty disables cross-origin requests |
| `ENABLE_SWAGGER_UI`           | `true`                          | Serves Swagger UI at `/docs`                          |

No secret is ever committed. `.env` is git-ignored; `.env.example` holds placeholders only.

---

## Project layout

```
prisma/          schema.prisma, migrations, seed
src/
  server.ts      starts the HTTP server, graceful shutdown
  app.ts         buildApp(deps): plugins and routes, never listens
  config/env.ts  Zod-validated environment
  plugins/       error handler, prisma, security, swagger
  common/        errors, clock, dates, cursors, pagination
  features/      one folder per feature: routes → service → repository
  generated/     Prisma client (generated, git-ignored)
test/
  helpers/       test app, Testcontainers setup, factories
  unit/          pure unit tests (no database)
  features/      one integration test file per feature
```

Each feature follows **routes → service → repository**. Routes only declare schemas, call
the service and return the result. Services hold business rules and permission checks and
never import Fastify. Repositories are the only layer that uses Prisma.

---

## API conventions

Base URL `/api/v1`. JSON, UTF-8, camelCase fields, UUID ids, ISO-8601 UTC timestamps.

Every error — validation failure, permission denial or crash — comes back in one shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "fields": { "title": "LENGTH_INVALID" },
    "requestId": "b7c1e2..."
  }
}
```

Clients switch on `code`, never on `message`. `X-Request-Id` is returned on every
response and echoed from the request when the client supplies one.

The generated `openapi.yaml` is the published contract. CI fails if it drifts from the
code, because both come from the same Zod schemas.

---

## Testing

| Level       | Tool                                         | Covers                                                      |
| ----------- | -------------------------------------------- | ----------------------------------------------------------- |
| Unit        | Vitest                                       | Services, validation, position math, cursors, date handling |
| Integration | Vitest + `app.inject()` + Testcontainers     | Every endpoint: success, 400, 401, 403/404, 409             |
| Migration   | `prisma migrate deploy` on a fresh container | All migrations apply cleanly from zero                      |

`npm test` starts one PostgreSQL 16 container for the whole run and applies every
migration from zero before any test executes, so the migration path is exercised on every
run. Without Docker, use `npm run test:no-db` for the subset that does not need a
database.

---

## Version pins

Dependencies are pinned exactly (no `^`) so every machine and CI run resolves the same
tree. Three pins are deliberately not the newest published version:

| Package                      | Pinned | Why not latest                                                                                    |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `typescript`                 | 5.9.3  | `typescript-eslint` declares `typescript <6.1.0`; TypeScript 7 is not supported by the linter yet |
| `vitest`                     | 4.1.11 | Vitest 5 requires Node >= 22.12; Vitest 4 runs on Node 20 as well                                 |
| `@testcontainers/postgresql` | 11.7.1 | Version 12 depends on `undici` 8, which needs Node >= 22                                          |

All three can move up once the project standardises on Node 22+; nothing else in the
stack blocks it.

## Hand-written migrations

`prisma/migrations/20260917000100_case_insensitive_label_names` creates a unique index on
`(workspace_id, lower(name))` for labels. Prisma's schema language cannot express a
functional index, so the index is invisible to `schema.prisma`.

**Consequence:** `prisma migrate dev` may propose a migration that drops it. Never accept
such a migration — delete the generated file and keep the index.

---

## Deployment

The multi-stage `Dockerfile` installs and builds with `npm ci` and `tsc`, runs
`prisma generate`, then copies `dist/`, production dependencies and the Prisma client into
a slim Node image. The container runs `prisma migrate deploy` before starting the server.

HTTPS is required in staging and production, because Android blocks cleartext traffic by
default.

`GET /api/v1/health` returns `{"status":"UP","database":"UP","version":"1.0.0"}` for
uptime checks and is exempt from rate limiting.

---

## Implementation status

Built phase by phase (PRD §A7). Current phase: **0 — Foundation**.

- [x] **Phase 0** — Foundation: app factory, env validation, logging, error handling, security plugins, OpenAPI, Prisma schema and first migration, health check, Docker, CI
- [ ] **Phase 1** — Auth and users
- [ ] **Phase 2** — Workspaces and permissions
- [ ] **Phase 3** — Boards and tasks
- [ ] **Phase 4** — Comments, attachments, activity
- [ ] **Phase 5** — Sync
- [ ] **Phase 6** — Real-time
- [ ] **Phase 7** — Push notifications
- [ ] **Phase 8** — Hardening and handoff
