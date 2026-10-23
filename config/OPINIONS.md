# OPINIONS.md - global stack defaults (human-decided 2026-10-12, grilled)

Sections per stack, terse. Project OPINIONS.md lists deviations only;
project deviation wins over global default.

Rule: OSS-first. Self-hosted OSS is default; cloud free tier only where
self-host cost exceeds its value. Paid extras (Pro tiers, ee/ dirs,
dashboards) are never assumed. Declared non-OSS exceptions listed at
bottom, each with reason; everything else must be OSI-licensed.

## cross-cutting

- Auth: Clerk hosted default; Keycloak self-host fallback.
  Apps validate JWT, no homegrown passwords.
- Observability: OpenTelemetry traces + metrics + structured logs from day one.
  LLM calls additionally: Langfuse self-hosted (traces, evals, prompt mgmt).
- Deploy: container-first (Dockerfile + compose per service from slice one;
  k8s only when multi-env demands it).
- Secrets: Infisical self-host (cloud fallback); .env local, never committed.
- E2E: Playwright validating product intent/vision after slice work, all stacks.
- Realtime ladder: in-app channels first (SignalR / ws); Redis Streams at
  horizontal scale; Kafka (KRaft) at multi-consumer scale.
  Redpanda excluded (BSL, not OSS).
- Search: Postgres FTS (tsvector/trigram) first; Meilisearch (MIT) when outgrown.
- CI/IaC: GitHub Actions + OpenTofu; floci for local testing.
- Edge: app-native; Traefik (MIT) gateway only when multi-service
  auth/rate needs force it.
- Flags: OpenFeature API + self-hosted flagd everywhere; dotnet uses
  Microsoft.FeatureManagement.AspNetCore. (Flipt excluded: v2 is FSL, not OSS.)
- Analytics: PostHog (MIT core self-host; cloud free tier fallback).
- Payments: Kushki (LatAm rails; processing inherently hosted).
- Content: git Markdown/MDX; headless CMS only when non-dev editors need it.
- Monorepo: pnpm workspaces + Turborepo (Nx if Vercel-averse).
- Desktop: Tauri v2 (Rust core + webview; React reuse).
- Email: Resend (deliverability exception). Push: Expo Push (pairs with Expo).
- Storage: S3-compatible API; cloud S3/R2 prod; RustFS local testing only.
  Libs: dotnet FluentStorage; node unstorage (flydrive dead since 2021);
  python fsspec/s3fs; go + rust per project.
- Cron: in-app schedulers (Quartz / BullMQ repeatable / Taskiq cron).
- Backoffice: custom minimal admin in the main app.
- API contracts: OpenAPI 3.1 generated from code; Scalar for docs UI.
- Perf rule: boring defaults below; hot-path libs per stack are opt-ins,
  profile-first, never assumed.

## AI / LLM

- Runtime: Ollama local; hosted APIs via provider SDKs directly, no proxy default.
- RAG store: pgvector in existing Postgres; Qdrant (Apache-2.0) when outgrown.
- Framework: none. SDK + structured outputs + own loops.
- Eval/obs: Langfuse self-hosted; OTel spans underneath.

## frontend

- React 19 + TS (TS 7 native port when plugins allow), Vite,
  TanStack Query/Router. Mobile: React Native / Expo.
- Idiom: airbnb/javascript base (deviations documented).
- Game: Unity + C# (declared exception; mobile 3D).
  Libs all MIT: MemoryPack, UniTask (maintenance mode, stable), R3.

## dotnet

- Web API: controllers over minimal endpoints (discoverability, filters).
- Data: EF Core default; DbUp migrations; Dapper raw when needed.
- Design: Zoran Horvat Emergent Design corpus mandatory (codinghelmet.com):
  no null returns (Option/Result), Null/Special-Case objects,
  polymorphism over if-switch on type codes, immutable records +
  nondestructive mutation, encapsulation (no leaking setters/collections),
  guard clauses, no throwing ArgumentException-style validation
  (use Result). Cyclomatic-complexity reduction is the metric.
- Handlers: martinothamar Mediator (MIT, source-gen, AOT-friendly) for
  request/handler decoupling; Result<T> via Ardalis.Result (MIT) for
  expected domain failures, exceptions stay for truly exceptional.
- Jobs: Hangfire core (LGPL).
- Prod bundle: Redis via FusionCache (HybridCache stdlib if single-node),
  OTel, /health.
- Workers: Threading.Channels simple; TPL Dataflow complex pipelines.
- Hot-path opt-ins: MemoryPack + R3 (UniTask on Unity). Logging: Serilog.
- Idiom: Horvat Emergent Design corpus (see Design line above, mandatory).
- xUnit (v3 line current) + WebApplicationFactory API tests.

## node

- TypeScript strict, ESM, pnpm; vitest over jest for new repos.
- Fastify-first APIs (schema validation + speed); Express trivial mocks only.
- HTTP client: undici (official, powers fetch).
- Prod bundle: Prisma Postgres + migrations (Accelerate/Pulse never assumed),
  BullMQ on Redis (Pro extras never assumed), OTel.
- Workers: Piscina CPU pool; BullMQ durable jobs.
- Idiom: goldbergyoni/nodebestpractices (which layers, error handling,
  structure) + airbnb/javascript base.
- Hot-path opt-ins: msgpackr (or v8.serialize if Node-only dep shave).

## python

- pytest, ruff, uv-managed venvs; pydantic at every trust boundary.
- FastAPI APIs, Click CLIs (Typer same base, either fine).
- Prod bundle: SQLAlchemy + Alembic, Taskiq on Redis (arq retired:
  quiet cadence), OTel.
- Workers: ProcessPoolExecutor CPU, anyio task groups IO; Taskiq durable jobs.
- Idiom: Effective Python (Slatkin) rule items.
- Hot-path opt-ins: msgspec, orjson, uvloop; numpy/numba numeric.

## go

- Gin-first HTTP (stdlib ServeMux/chi lighter alt if no Gin middleware need);
  gofmt/vet/test gates.
- database/sql + sqlc; golang-migrate (revived; goose alt for pg-first DX).
- Prod bundle: Redis, OTel, /healthz; slog structured logs.
- Workers: errgroup + x/sync semaphore pools; no fire-and-forget goroutines.
- Wire default: protobuf.
- Idiom: Uber Go Style Guide + Effective Go official.
- Hot-path opt-ins: sonic (asm archs only; goccy/go-json if portability),
  fasthttp (profiled only), sync.Pool buffers.

## rust

- actix-web max-throughput default (axum only if team wants tower alignment);
  fmt + clippy-deny-warnings + test gates.
- Prod bundle: sqlx migrations (PG/MySQL/SQLite; MSSQL gated behind paid
  SQLx Pro, excluded), Redis via redis-rs + deadpool-redis
  (fred dormant 19mo), OTel tracing, /health.
- Workers: tokio tasks async, rayon CPU pools; bounded channels between.
- Idiom: rust-unofficial Design Patterns + Rust API Guidelines
  (public API surface).
- Hot-path opt-ins: rkyv/zerocopy hot structs, simd-json profiled;
  mimalloc optional.

## declared non-OSS exceptions

- Clerk (auth, hosted-first) / Keycloak fallback self-host.
- Unity (mobile 3D, no OSS match). Godot only if project fits it.
- Resend (email deliverability). Expo Push (APNs reality).
- Kushki (payment rails). Cloud S3/R2 prod (ops cost beats self-host value).
- GitHub Actions (CI ecosystem; Woodpecker/Forgejo if self-host forced).
- Hangfire core LGPL (dashboard cases only; Pro never).
- BullMQ Pro / Prisma platform / PostHog ee (never assumed).

## principles (new + existing code)

- SOLID + CUPID + Horvat-global + per-stack idiom authorities (see stack
  sections) are PR review gates.
  Violations need written justification, not silent passes.
- Horvat-global (all stacks): no null returns (Option/Maybe/Result or
  idiomatic equivalent); polymorphism/composition over if-switch on
  type codes; Tell Don't Ask, encapsulated collections, no leaking setters.
  (Immutability-by-records stays C#-only; other stacks use their idiom.)
- SOLID + CUPID (Composable, Unix philosophy, Predictable, Idiomatic,
  Domain-based: https://8c9d0580.cupiddev.pages.dev/). Details above.
- New code follows this file strictly. Existing code: boy scout rule,
  migrate opportunistically at touch points; no big-bang rewrites.
- Style: per-stack idiom wins (CUPID Idiomatic). No global naming/length rules.
- Format enforced in CI, zero discussion: gofmt, rustfmt, ruff format,
  prettier (js/ts), dotnet format. Unformatted diff fails the gate.

## error handling (global doctrine + per-stack idiom)

- Global: every raise carries context; no bare catches; never swallow;
  log once (at handling, not at every layer); fail loud over default values;
  map to stable codes at API boundary (ProblemDetails / RFC 9457 shape).
- dotnet: hybrid - Ardalis.Result<T> expected failures, exceptions
  exceptional; ProblemDetails at API boundary. node: throw with cause, zod at
  boundary, Fastify error handler maps codes. python: exceptions,
  raise ... from, pydantic at boundary. go: fmt.Errorf %w wrap + sentinel
  errors, errors.Is/As at boundary. rust: thiserror libs, anyhow apps.
- Tests: required at trust boundaries and contracts first; TDD where cheap,
  tests-after acceptable. No coverage theater.
