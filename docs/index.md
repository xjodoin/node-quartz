# Node Quartz

Distributed, resilient, Redis‑backed job scheduler for Node.js with cron support, multi‑queue workers, retries + DLQ, definition stores, and a focused CLI.

- Cron with seconds and optional per‑job timezone
- Redis keyspace notification scheduling and jittered master election
- Multi‑queue workers (`BLMOVE` with `RPOPLPUSH` fallback)
- Retries with backoff + failed queue
- Job Definitions Store (memory/file/custom) synced across instances
- Powerful CLI for failed jobs and definitions
- TypeScript types, CI, Docker Compose tests

## Quick Links
- [Installation](installation.md)
- [Usage](usage.md)
- [CLI](cli.md)
- [Job Store](store.md)
- [Architecture](architecture.md)
- [API](api.md)

## Requirements
- Node.js >= 14
- Redis with keyspace notifications for expired events enabled: `notify-keyspace-events Ex`
