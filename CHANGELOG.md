# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2025-09-12

### Breaking Changes
- Node.js 14+ required; project migrated to TypeScript with `dist/` as the published entry.
- Internal import paths changed; consumers should import the package root (e.g., `const create = require('node-quartz')`).
- Removed legacy dependencies (`lodash`, `moment`, `moment-range`, `winston`). Logging now uses an injectable logger (defaults to `console`).
- Redis keyspace notifications for `expired` must be enabled (`notify-keyspace-events Ex`).

### Features
- Redis v4 async client with dedicated pub/sub connection and jittered master heartbeat for robustness.
- Worker improvements:
  - Multi-queue consumption using `BLMOVE` (Redis >= 6.2), fallback to `RPOPLPUSH`.
  - Opportunistic enqueue on `:next` and `:retry` expirations to improve single-process reliability.
- Retries + DLQ:
  - Per-job retry policy with backoff (number or object). Failed runs go to a `<prefix>:failed` list.
- Job Definition Store and Sync:
  - Load job definitions from memory/file/custom stores.
  - Persist and synchronize definitions in Redis using `<prefix>:defs:*` keys and a `<prefix>:defs:events` pub/sub channel.
- CLI Enhancements:
  - Failed queue: list/requeue/delete/import/export, by index or by id.
  - Definitions: list/add/remove/reload across instances.
- Developer Experience:
  - TypeScript types and strict build; `types` points to `dist/index.d.ts`.
  - Docker Compose-based integration testing.
  - GitHub Actions release workflow (publishes on version tags; tests skipped in release workflow).

### Improvements
- Safer shutdown: defensive guards prevent Redis operations after closing; best-effort unsubscribe and disconnect to avoid test hangs.
- SCAN-based key listing replaces blocking KEYS calls.
- Reduced worker polling latency and improved responsiveness under load.

### Migration Notes
- If you previously imported internal paths (e.g., `lib/quartz`), switch to the package root.
- Ensure Redis is configured with keyspace notifications: `redis-server --notify-keyspace-events Ex` (or set via `CONFIG SET`).
- Processors may be provided via `scriptsDir` (required modules) or via the `processors` map in options.
- Consider using the new Job Store to persist and synchronize scheduled jobs across instances.

