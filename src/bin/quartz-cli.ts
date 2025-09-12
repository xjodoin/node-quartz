/* eslint-disable no-console */
import { createClient } from 'redis';
import * as fs from 'fs';
import * as path from 'path';

type Args = { _: string[]; [k: string]: any };

function parseArgs(argv: string[]): Args {
  const args: Args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) { args[key] = next; i++; } else { args[key] = true; }
    } else if (a.startsWith('-')) {
      const key = a.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) { args[key] = next; i++; } else { args[key] = true; }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function k(prefix: string, ...parts: string[]) { return [prefix].concat(parts).join(':'); }

function usage() {
  console.log(`node-quartz CLI

Usage:
  quartz failed:list [--prefix <p>] [--redis <url>] [--count <n>]
  quartz failed:requeue --idx <i> [--prefix <p>] [--redis <url>] [--reset]
  quartz failed:delete --idx <i> [--prefix <p>] [--redis <url>]
  quartz failed:purge [--prefix <p>] [--redis <url>]
  quartz failed:get --id <jobId> [--prefix <p>] [--redis <url>]
  quartz failed:requeue-id --id <jobId> [--prefix <p>] [--redis <url>] [--reset]
  quartz failed:delete-id --id <jobId> [--prefix <p>] [--redis <url>]
  quartz failed:drain-to-file --out <file.json> [--prefix <p>] [--redis <url>] [--purge]
  quartz failed:import-from-file --in <file.json> [--prefix <p>] [--redis <url>] [--requeue] [--reset]

Environment:
  REDIS_URL can be used instead of --redis
`);
}

async function main() {
  const args = parseArgs(process.argv);
  const cmd = args._[0];
  if (!cmd) { usage(); process.exit(1); }

  const prefix = args.prefix || process.env.QUARTZ_PREFIX || 'quartz';
  const url = args.redis || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const client = createClient({ url });
  await client.connect();
  const failedKey = k(prefix, 'failed');
  const jobsKey = k(prefix, 'jobs');

  try {
    if (cmd === 'failed:list') {
      const count = parseInt(args.count || '10', 10);
      const len = await client.lLen(failedKey);
      const items: any[] = [];
      const max = Math.min(count, len);
      for (let i = 0; i < max; i++) {
        const item = await client.lIndex(failedKey, i);
        if (!item) break;
        try {
          const env = JSON.parse(item);
          const job = env.job || {};
          const err = env.error;
          items.push({ idx: i, id: job.id, attempt: job.attempt, error: err && String(err).slice(0, 120) });
        } catch {
          items.push({ idx: i, raw: item.slice(0, 120) + (item.length > 120 ? '…' : '') });
        }
      }
      console.log(JSON.stringify({ total: len, items }, null, 2));
    } else if (cmd === 'failed:requeue') {
      const idx = parseInt(args.idx, 10);
      if (Number.isNaN(idx)) { console.error('Missing --idx'); process.exit(2); }
      const item = await client.lIndex(failedKey, idx);
      if (!item) { console.error('No item at that index'); process.exit(3); }
      const env = JSON.parse(item);
      const job = env.job;
      if (!job) { console.error('Invalid envelope (no job)'); process.exit(4); }
      if (args.reset) { job.attempt = 0; }
      await client.rPush(jobsKey, JSON.stringify(job));
      await client.lRem(failedKey, 1, item);
      console.log('Requeued job', job.id);
    } else if (cmd === 'failed:delete') {
      const idx = parseInt(args.idx, 10);
      if (Number.isNaN(idx)) { console.error('Missing --idx'); process.exit(2); }
      const item = await client.lIndex(failedKey, idx);
      if (!item) { console.error('No item at that index'); process.exit(3); }
      await client.lRem(failedKey, 1, item);
      console.log('Deleted item', idx);
    } else if (cmd === 'failed:purge') {
      await client.del(failedKey);
      console.log('Purged failed queue');
    } else if (cmd === 'failed:get' || cmd === 'failed:requeue-id' || cmd === 'failed:delete-id') {
      const jobId = args.id;
      if (!jobId) { console.error('Missing --id <jobId>'); process.exit(2); }
      const len = await client.lLen(failedKey);
      let found: { idx: number; item: string; env: any } | null = null;
      for (let i = 0; i < len; i++) {
        const item = await client.lIndex(failedKey, i);
        if (!item) break;
        try {
          const env = JSON.parse(item);
          if (env && env.job && env.job.id === jobId) { found = { idx: i, item, env }; break; }
        } catch (e) { void e; }
      }
      if (!found) { console.error('Job not found in failed queue'); process.exit(3); }
      if (cmd === 'failed:get') {
        console.log(JSON.stringify({ idx: found.idx, envelope: found.env }, null, 2));
      } else if (cmd === 'failed:requeue-id') {
        const job = found.env.job;
        if (args.reset) { job.attempt = 0; }
        await client.rPush(jobsKey, JSON.stringify(job));
        await client.lRem(failedKey, 1, found.item);
        console.log('Requeued job', job.id);
      } else if (cmd === 'failed:delete-id') {
        await client.lRem(failedKey, 1, found.item);
        console.log('Deleted job', jobId);
      }
    } else if (cmd === 'failed:drain-to-file') {
      const out = args.out;
      if (!out) { console.error('Missing --out <file.json>'); process.exit(2); }
      const outPath = path.resolve(process.cwd(), out);
      const len = await client.lLen(failedKey);
      const items: any[] = [];
      for (let i = 0; i < len; i++) {
        const item = await client.lIndex(failedKey, i);
        if (!item) break;
        try { items.push(JSON.parse(item)); } catch { items.push({ raw: item }); }
      }
      fs.writeFileSync(outPath, JSON.stringify(items, null, 2));
      if (args.purge) { await client.del(failedKey); }
      console.log(`Wrote ${items.length} items to ${outPath}${args.purge ? ' and purged failed queue' : ''}`);
    } else if (cmd === 'failed:import-from-file') {
      const input = args.in;
      if (!input) { console.error('Missing --in <file.json>'); process.exit(2); }
      const inPath = path.resolve(process.cwd(), input);
      if (!fs.existsSync(inPath)) { console.error('File not found:', inPath); process.exit(3); }
      let data: any;
      try { data = JSON.parse(fs.readFileSync(inPath, 'utf8')); } catch (e: any) { console.error('Invalid JSON:', e.message); process.exit(4); }
      if (!Array.isArray(data)) { console.error('Expected an array in file'); process.exit(5); }
      let imported = 0;
      const requeue = !!args.requeue;
      const reset = !!args.reset;
      for (const entry of data) {
        try {
          if (requeue) {
            let job: any = null;
            if (entry && typeof entry === 'object') { job = entry.job ? entry.job : entry; }
            else if (typeof entry === 'string') { try { const parsed = JSON.parse(entry); job = parsed.job || parsed; } catch { job = null; } }
            if (!job || !job.id) continue;
            if (reset) job.attempt = 0;
            await client.rPush(jobsKey, JSON.stringify(job));
            imported++;
          } else {
            let payload: any;
            if (entry && typeof entry === 'object') { payload = entry.job ? entry : { job: entry, error: 'imported', failedAt: new Date().toISOString() }; }
            else if (typeof entry === 'string') {
              try { const parsed = JSON.parse(entry); payload = parsed.job ? parsed : { job: parsed, error: 'imported', failedAt: new Date().toISOString() }; }
              catch { payload = { raw: entry, error: 'imported', failedAt: new Date().toISOString() }; }
            }
            if (!payload) continue;
            await client.rPush(failedKey, JSON.stringify(payload));
            imported++;
          }
        } catch { /* ignore */ }
      }
      console.log(`${requeue ? 'Requeued' : 'Imported'} ${imported} item(s)`);
    } else {
      usage();
      process.exit(1);
    }
  } finally {
    await client.quit();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

