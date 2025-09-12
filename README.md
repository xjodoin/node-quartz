# NodeJs Distributed and resilient job scheduling framework

## Installation

It's on NPM.

	npm install node-quartz

## Quick Start

```bash
# 1) Start Redis with keyspace notifications enabled
# Local (requires redis-server installed):
redis-server --notify-keyspace-events Ex

# Or via Docker:
docker run --rm -p 6379:6379 redis:7 redis-server --notify-keyspace-events Ex

# 2) In another terminal, run the demo (closes after ~35s)
# Optionally set REDIS_URL if Redis isn't on localhost
export REDIS_URL=redis://127.0.0.1:6379
npm run demo

# 3) Inspect failed jobs (if any) with the CLI
npx quartz failed:list --count 20 --redis "$REDIS_URL" --prefix quartz:test

# Requeue the first failed job and reset attempts
npx quartz failed:requeue --idx 0 --reset --redis "$REDIS_URL" --prefix quartz:test
```

## Usage

```javascript
  // create an instance
  const create = require('node-quartz');
  const quartz = create({
    scriptsDir: '/my/scripts/path',
    prefix: 'quartz', // optional, defaults to 'quartz'
    logger: console, // optional, provide your own logger (debug/info/warn/error)
    queues: ['high', 'default', 'low'], // optional, defaults to ['default']
    heartbeat: { intervalMs: 2000, jitterMs: 500 }, // optional jittered master heartbeat
    redis: {
      // Prefer url form; legacy host/port also supported
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    },
    // Optional: provide in-memory processors map instead of requiring files
    // processors: { 'scriptToRun': async (job) => { /* ... */ } }
  });

  // schedule a job (6-field cron with seconds)
  const job = {
    id: 'job_id',
    script: 'scriptToRun', // resolved relative to scriptsDir
    cron: '*/10 * * * * *', // every 10 seconds
    data: { any: 'payload' }, // optional payload passed to your script via job.data
    queue: 'high', // optional, defaults to 'default'
    options: {
      currentDate: null,
      endDate: new Date(Date.now() + 60 * 1000),
      tz: 'America/New_York' // optional, timezone for cron schedule
    }
  };

  quartz.scheduleJob(job);

  // Later, shut down cleanly (unsubscribe and quit Redis):
  // await quartz.close();
```

Your job processor module (at `/my/scripts/path/scriptToRun.js`) should export a function
and may be sync, callback-based, or async (Promise):

```javascript
// /my/scripts/path/scriptToRun.js
module.exports = function (job, done) {
  // access job.data if you provided it
  console.log('processing job', job.id, job.data);
  // do work, then call done(err?)
  done();
};
// or, Promise/async style
// module.exports = async function (job) {
//   console.log('processing job', job.id, job.data);
//   // await work
// };
```
  
## Requirements
- Node.js >= 14
- Redis with keyspace notifications for `expired` enabled (`notify-keyspace-events Ex`).
  - Local example: `redis-server --notify-keyspace-events Ex`
  - Docker Compose/service: add args `--notify-keyspace-events Ex`

## Redis Options
- `redis.url`: connection string, e.g. `redis://localhost:6379`
- `redis.database`: database index (number). Defaults to 0. Keyspace notifications
  subscriptions use this DB for `__keyevent@<db>__:*`.
- Legacy `redis.host` and `redis.port` are still accepted and converted to a URL

## Other Options
- `prefix`: Redis key prefix (default `quartz`). Keys: `<prefix>:jobs`, `<prefix>:processing`,
  `<prefix>:jobs:<id>`, `<prefix>:jobs:<id>:next`, `<prefix>:master`.
- `logger`: pluggable logger with `debug/info/warn/error` methods; defaults to `console`.
- `processors`: object map of `{ [scriptName]: processorFn }` to avoid dynamic require().
- `queues`: array of queue names to poll (default `['default']`). Jobs with `job.queue` are pushed
  to `<prefix>:q:<queue>:jobs` and processed atomically into `<prefix>:q:<queue>:processing`.
- `heartbeat`: `{ intervalMs?: number, jitterMs?: number }` controls master heartbeat frequency
  and random jitter (defaults: 2000ms interval, ±500ms jitter).

## Retries and Failures
- Set `retry` on the job (top-level or under `options.retry`):
  - `maxAttempts`: number of retry attempts
  - `backoff`: either a number (base delay ms, exponential) or an object
    `{ delay: number, factor?: number, maxDelay?: number }`
- On failure:
  - If attempts remain, the job is scheduled for retry using key expiry (`<prefix>:jobs:<id>:retry`).
  - If exhausted, the job is pushed to `<prefix>:failed` with minimal error info.
- Cron jobs: on success they reschedule to the next run; on failure they follow the retry policy for the current run, and continue with future schedules after retries are exhausted.

## Worker Loop
- A background worker loop consumes `<prefix>:jobs` via `BRPOPLPUSH`, moves items to `<prefix>:processing`, and runs your processor.
- With multiple queues, the worker attempts an atomic `BLMOVE` from each queue's jobs list to its processing list (Redis >= 6.2),
  falling back to round‑robin `RPOPLPUSH` with short sleeps.
- On startup, it recovers orphaned items from each `<prefix>:q:<queue>:processing` back to `<prefix>:q:<queue>:jobs`.
- `close()` stops the loop and quits Redis gracefully.

## API
- Factory: `const quartz = create(options)`
- Methods:
  - `scheduleJob(job)`: schedule or enqueue a job (supports 6-field cron with seconds)
  - `getJob(jobId, cb)`: fetch stored job payload
  - `removeJob(jobId, cb)`: delete stored job payload
  - `listJobsKey(cb)`: list all persisted job keys for the prefix
  - `close(cb?)`: stop worker loop and quit Redis connections
- Events (`quartz.events` is an EventEmitter):
  - `scheduled` (job, nextDate)
  - `started` (job)
  - `succeeded` (job)
  - `failed` (job, error)
  - `retryScheduled` (job, delayMs)

The library uses `node-redis` v4 (async).

## CLI
Install globally or use via `npx`:

- List failed jobs: `quartz failed:list --prefix quartz --redis redis://localhost:6379 --count 20`
- Requeue a failed job: `quartz failed:requeue --idx 0 --prefix quartz --redis redis://localhost:6379 --reset`
- Delete a failed job: `quartz failed:delete --idx 0 --prefix quartz --redis redis://localhost:6379`
- Purge failed queue: `quartz failed:purge --prefix quartz --redis redis://localhost:6379`
- Inspect by id: `quartz failed:get --id <jobId> --prefix quartz --redis redis://localhost:6379`
- Requeue by id: `quartz failed:requeue-id --id <jobId> --prefix quartz --redis redis://localhost:6379 --reset`
- Delete by id: `quartz failed:delete-id --id <jobId> --prefix quartz --redis redis://localhost:6379`
- Export failed to file: `quartz failed:drain-to-file --out failed.json --prefix quartz --redis redis://localhost:6379 --purge`
- Import failed from file: `quartz failed:import-from-file --in failed.json --prefix quartz --redis redis://localhost:6379`
- Requeue from file: `quartz failed:import-from-file --in failed.json --requeue --reset`

You can also set env vars: `REDIS_URL` and `QUARTZ_PREFIX`.

## Testing
- Start Redis with keyspace notifications: `redis-server --notify-keyspace-events Ex`
- Run tests: `npm test`
- CI workflow runs tests against Redis (with notifications enabled) on Node 14/16/18/20.

### With Docker Compose
- Run tests in containers (spins Redis and a Node runner):
  - `docker compose up --abort-on-container-exit --exit-code-from test`
  - Or via npm script: `npm run test:compose`
  - The test runner mounts your working directory and uses `REDIS_URL=redis://redis:6379`.
