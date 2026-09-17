# Changelog

Every contract change is recorded here. Breaking changes (renaming or removing a field,
changing a type) need agreement with the Android developer and go to `/api/v2` or behind
a new field; adding an optional field is non-breaking.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

All 42 REST endpoints and the WebSocket from the specification, matching `openapi.yaml`.

- **Auth** — register, login, refresh with rotation and theft detection, logout. Access
  tokens are 15-minute JWTs; refresh tokens are 30-day random values stored only as
  SHA-256 hashes.
- **Users and devices** — profile, name update, avatar upload, FCM token registration.
- **Workspaces** — create, list, rename, delete, members with OWNER/ADMIN/MEMBER roles,
  and labels with case-insensitive per-workspace uniqueness.
- **Boards and tasks** — full CRUD, filters, sorting, offset pagination, fractional
  positions with automatic renumbering, optimistic locking returning 409 with the server
  copy in `current`, and idempotent creates from a client-supplied id.
- **Comments, attachments and activity** — cursor-paginated comments and feed, uploads
  typed from their leading bytes, and one activity row per write.
- **Delta sync** — `GET /workspaces/{id}/sync` with a five-second overlap window,
  soft-deleted rows, and 500-row paging with `hasMore`.
- **WebSocket** — `ws/workspaces/{id}` broadcasting every write, with close codes 4401,
  4403 and 4404.
- **Push** — FCM data messages for assignment, comments, mentions, workspace invites and
  a daily due-soon sweep. Falls back to logging the payload when no credentials are set.
- **File serving** — locally stored uploads are served at `/files/{key}`, so the URLs
  returned by avatar and attachment uploads resolve. Skipped when `STORAGE_BUCKET` is set,
  since a bucket serves its own URLs.
- **Conventions** — one error body everywhere, `X-Request-Id` on every response, rate
  limits, structured logs with credential redaction, and graceful shutdown.
