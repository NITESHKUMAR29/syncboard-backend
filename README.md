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

You need Node.js and nothing else. No database to install, no Docker, no accounts.

```bash
cp .env.example .env         # then set JWT_SECRET (see below)
npm install
npm run db:migrate           # creates the database under ./data
npm run db:seed              # 3 users, 2 workspaces, sample tasks
npm run dev                  # http://localhost:8080
```

Generate a JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Check it is alive:

```bash
curl http://localhost:8080/api/v1/health
# {"status":"UP","database":"UP","version":"1.0.0"}
```

**Browse and try every endpoint at <http://localhost:8080/docs>** — Swagger UI, with a
"Try it out" button on each one. Log in through `POST /auth/login` first, paste the
`accessToken` into the green **Authorize** button, and the rest will work.

### Seeded accounts

Password for all three: `Password123`

| Email                 | Role   | Can do                                         |
| --------------------- | ------ | ---------------------------------------------- |
| `owner@taskflow.dev`  | OWNER  | Everything, including deleting the workspace   |
| `admin@taskflow.dev`  | ADMIN  | Boards, labels, members — but not role changes |
| `member@taskflow.dev` | MEMBER | Tasks, comments, attachments                   |

### Connecting from the Android emulator

The emulator reaches your Mac at `10.0.2.2`, not `localhost`:

```
http://10.0.2.2:8080/api/v1
```

The server already listens on `0.0.0.0`, so nothing else is needed. Android blocks
cleartext HTTP by default — for local development add a debug
`network_security_config.xml` permitting `10.0.2.2`, or put the app in debug mode with
`android:usesCleartextTraffic="true"`. Production must be HTTPS.

The WebSocket is at `ws://10.0.2.2:8080/api/v1/ws/workspaces/{id}`, with the same
`Authorization: Bearer` header as the REST calls.

## Where the data lives

`DATABASE_URL` picks the driver by its scheme, and nothing else changes:

| `DATABASE_URL`             | What it is                                                              | Use it for                                     |
| -------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| `pglite://./data/taskflow` | PostgreSQL compiled to WebAssembly, in this process, stored in `./data` | Local development — the default                |
| `pglite://memory`          | The same, in RAM, discarded on exit                                     | Tests                                          |
| `postgresql://…`           | A real PostgreSQL server                                                | Deployment, or to check against the real thing |

PGlite is the same PostgreSQL engine, so the schema, the migrations and every query are
identical to what a server runs. When you deploy, you swap the URL.

### Moving to Neon for deployment

Your phone cannot reach a server running on your laptop, so deploying means a hosted
database. Neon's free tier is enough.

1. In your Neon project, copy the **direct** (unpooled) connection string.
2. Create a second, empty database — call it `taskflow_shadow`. `prisma migrate dev`
   needs a throwaway database to verify new migrations against, and managed providers do
   not always let it create one.
3. Set both, then migrate:

   ```bash
   DATABASE_URL=postgresql://USER:PASSWORD@ep-xxx.REGION.aws.neon.tech/taskflow?sslmode=require
   SHADOW_DATABASE_URL=postgresql://USER:PASSWORD@ep-xxx.REGION.aws.neon.tech/taskflow_shadow?sslmode=require
   ```

   ```bash
   npm run db:migrate    # runs prisma migrate deploy against the server
   ```

Free Neon projects suspend when idle, so the first request after a pause takes about half
a second.

`docker-compose.yml` is also there if you would rather run PostgreSQL locally:
`docker compose up -d`, then point `DATABASE_URL` at `localhost:5432`.

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

| Variable                      | Default                         | Notes                                                        |
| ----------------------------- | ------------------------------- | ------------------------------------------------------------ |
| `NODE_ENV`                    | `development`                   | `development` \| `test` \| `production`                      |
| `PORT`                        | `8080`                          | Keeps the emulator URL at `http://10.0.2.2:8080`             |
| `HOST`                        | `0.0.0.0`                       | Must not be `127.0.0.1` for the emulator to reach it         |
| `LOG_LEVEL`                   | `info`                          | Pino level                                                   |
| `DATABASE_URL`                | —                               | **Required**. Local PostgreSQL or a managed one such as Neon |
| `SHADOW_DATABASE_URL`         | empty                           | Only for `prisma migrate dev` against a managed database     |
| `JWT_SECRET`                  | —                               | **Required**, at least 32 characters                         |
| `JWT_ISSUER` / `JWT_AUDIENCE` | `taskflow` / `taskflow-android` | JWT claims                                                   |
| `ACCESS_TOKEN_TTL_MINUTES`    | `15`                            | Access token lifetime                                        |
| `REFRESH_TOKEN_TTL_DAYS`      | `30`                            | Refresh token lifetime                                       |
| `STORAGE_BUCKET` and friends  | empty                           | Empty means local disk under `STORAGE_LOCAL_DIR`             |
| `FIREBASE_CREDENTIALS_JSON`   | empty                           | Empty means push payloads are only logged                    |
| `CORS_ALLOWED_ORIGINS`        | empty                           | Comma-separated; empty disables cross-origin requests        |
| `ENABLE_SWAGGER_UI`           | `true`                          | Serves Swagger UI at `/docs`                                 |

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

## Trying the API by hand

Two ways, both with the server running (`npm run dev`):

**Swagger UI** at <http://localhost:8080/docs> — every endpoint with a "Try it out"
button. Send `POST /auth/login` first, copy the `accessToken`, paste it into the green
**Authorize** button, and the rest will work.

**Postman** — import `postman/TaskFlow.postman_collection.json` (Import → File). Open
**1. Auth → Log in (seeded OWNER)** and send it; the token is captured automatically and
applied to every other request. Ids flow the same way, so creating a workspace fills in
`{{workspaceId}}` for the requests that need it, and you can mostly work top to bottom.

The collection also demonstrates the behaviours worth understanding before wiring up the
app: an idempotent offline create, a 409 version conflict carrying the server's copy, and
what a MEMBER is refused.

To point it at the Android emulator, edit the `baseUrl` collection variable to
`http://10.0.2.2:8080/api/v1`.

## Testing

```bash
npm test              # everything
npm run test:coverage # with a coverage report
```

Every test file gets its own in-memory PostgreSQL with all migrations applied, so the
suite needs nothing installed, files cannot interfere with each other, and the whole thing
runs in seconds.

| Level       | Covers                                                                   |
| ----------- | ------------------------------------------------------------------------ |
| Unit        | Position maths, cursors, date handling, environment validation           |
| Integration | Every endpoint: success, 400, 401, 403/404, 409, against a real database |
| Permissions | Every row of the role matrix, allowed and denied                         |
| WebSocket   | A real socket on a real port: events after REST writes, and close codes  |
| Migration   | All migrations apply cleanly from zero                                   |

## Version pins

Dependencies are pinned exactly (no `^`) so every machine resolves the same tree. Two pins
are deliberately not the newest published version:

| Package      | Pinned | Why not latest                                                                                    |
| ------------ | ------ | ------------------------------------------------------------------------------------------------- |
| `typescript` | 5.9.3  | `typescript-eslint` declares `typescript <6.1.0`; TypeScript 7 is not supported by the linter yet |
| `vitest`     | 4.1.11 | Vitest 5 requires Node >= 22.12; Vitest 4 also runs on Node 20                                    |

Both can move up once the project standardises on Node 22 or newer.

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

All 42 REST endpoints and the WebSocket from the specification are implemented and tested.

- [x] Auth: register, login, refresh with rotation and theft detection, logout
- [x] Profile, avatar upload, device registration for push
- [x] Workspaces, members, roles, labels, and the full permission matrix
- [x] Boards: create, rename, reorder, archive, soft delete with their tasks
- [x] Tasks: CRUD, filters, sorting, pagination, fractional positions, optimistic locking, idempotent creates
- [x] Comments with cursor pagination, attachments with byte-level type checks, activity feed
- [x] Delta sync with an overlap window, soft-deleted rows and paging
- [x] WebSocket events after every write, with the documented close codes
- [x] Push notifications with an FCM sender and a logging fallback, plus the daily due-soon job
- [x] Rate limits, request ids, structured logs with redaction, graceful shutdown

### Not built (out of scope for v1, per the specification)

Email verification, password reset by email, OAuth, a web client, billing, full-text
search, running more than one server instance, and uploading files while offline.
