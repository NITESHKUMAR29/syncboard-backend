# Changelog

Every contract change is recorded here. Breaking changes (renaming or removing a field,
changing a type) need agreement with the Android developer and go to `/api/v2` or behind
a new field; adding an optional field is non-breaking.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — Phase 0 (Foundation)

- `GET /api/v1/health` — liveness check returning `status`, `database` and `version`.
  Public and exempt from rate limiting.
- Standard error body on every failure (`error.code`, `error.message`, optional
  `error.fields`, `error.requestId`) and `X-Request-Id` on every response.
- `openapi.yaml`, generated from the same Zod schemas that validate requests, plus
  Swagger UI at `/docs`.
- Database schema and first migration for all tables in PRD Part B §3.
