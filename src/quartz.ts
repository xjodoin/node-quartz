import { createClient, RedisClientType } from 'redis';
import * as os from 'os';
import { parseExpression } from 'cron-parser';
import * as path from 'path';
import { EventEmitter } from 'events';
import { CreateOptions, Job, Scheduler } from './types';

function create(options?: CreateOptions): Scheduler {
  options = options || {};

  let client: RedisClientType<any, any, any>;
  if (options.redis) {
    let url = options.redis.url;
    if (!url && (options.redis.host || options.redis.port)) {
      const host = options.redis.host || '127.0.0.1';
      const port = options.redis.port || 6379;
      url = 'redis://' + host + ':' + port;
    }
    const dbIndex = typeof options.redis.database === 'number' ? options.redis.database : undefined;
    client = createClient({ url, database: dbIndex, ...(options.redis.options || {}) });
  } else {
    client = createClient();
  }

  const pubsub = client.duplicate();
  const events = new EventEmitter();
  const logger = options.logger || console;
  const dbg = (...args: any[]) => { if (logger && typeof logger.debug === 'function') logger.debug(...args); };
  const err = (...args: any[]) => { if (logger && typeof logger.error === 'function') logger.error(...args); };

  const prefix = options.prefix || 'quartz';
  const queues = Array.isArray(options.queues) && options.queues.length > 0 ? options.queues : ['default'];
  const heartbeatCfg = options.heartbeat || {};
  const heartbeatBase = typeof heartbeatCfg.intervalMs === 'number' ? heartbeatCfg.intervalMs : 2000;
  const heartbeatJitter = typeof heartbeatCfg.jitterMs === 'number' ? heartbeatCfg.jitterMs : 500;
  const nextHeartbeatDelay = () => {
    const jitter = (Math.random() * 2 - 1) * heartbeatJitter;
    let delay = heartbeatBase + jitter;
    const minDelay = Math.max(100, Math.floor(heartbeatBase * 0.25));
    if (delay < minDelay) delay = minDelay;
    return Math.round(delay);
  };

  const k = (...parts: string[]) => [prefix].concat(parts).join(':');
  const qjobs = (q: string) => k('q', q, 'jobs');
  const qprocessing = (q: string) => k('q', q, 'processing');

  function dateReviver(key: string, value: any) {
    if (typeof value === 'string') {
      const a = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)Z$/.exec(value);
      if (a) return new Date(Date.UTC(+a[1], +a[2] - 1, +a[3], +a[4], +a[5], +a[6]));
    }
    return value;
  }

  let isMaster = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let closing = false;
  const isClientOpen = () => (client as any).isOpen && !closing;

  client.connect().then(() => {
    startWorkerLoop();
  }).catch((e) => err('Redis client connect error', e));

  pubsub.connect().then(() => {
    const handleEvent = (message: string, channel: string) => {
      try {
        if (closing) return;
        if (typeof message !== 'string') return;
        if (!message.startsWith(prefix)) return;
        dbg('new event', message, 'on', channel);
        if (message === k('master')) { dbg('master expired try to get lock'); master(); return; }
        // Opportunistically enqueue on ':next' or ':retry' expiry
        const key = message;
        const endNext = key.indexOf(':next');
        const endRetry = key.indexOf(':retry');
        const end = endNext > 0 ? endNext : (endRetry > 0 ? endRetry : -1);
        if (end > 0) {
          const jobKey = key.substring(0, end);
          client.get(jobKey).then((res) => {
            try { if (!res) return; addJob(JSON.parse(res, dateReviver)); }
            catch (e) { err(e); }
          }).catch((e) => err(e));
        }
      } catch (e) { err('Error handling pubsub event', e); }
    };
    const dbIndex = options.redis && typeof options.redis.database === 'number' ? options.redis.database : 0;
    pubsub.pSubscribe(`__keyevent@${dbIndex}__:expired`, handleEvent).catch((e) => err(e));
  }).catch((e) => err('Redis pubsub connect error', e));

  const master = () => {
    if (closing) return;
    const masterKey = k('master');
    client.set(masterKey, os.hostname(), { NX: true, EX: 5 }).then((res) => {
      if (!res) return;
      dbg('is now the master');
      isMaster = true;
      listJobsKey((_, keys = []) => {
        keys.forEach((key) => {
          client.exists(key + ':next').then((exist) => {
            if (exist === 0) {
              client.get(key).then((jobStr) => {
                try {
                  if (!jobStr) return;
                  const job = JSON.parse(jobStr, dateReviver) as Job;
                  if (job.cron) { dbg('reschedule job ' + key); scheduleJob(job); }
                } catch (e) { err(e); }
              }).catch((e) => err(e));
            }
          }).catch((e) => err(e));
        });
      });
    
      const tick = () => {
        if (closing) return;
        dbg('Heartbeat');
        client.get(masterKey).then((val) => {
          if (val === os.hostname()) {
            dbg('is the master update the ttl');
            if (isClientOpen()) return client.expire(masterKey, 5).catch((e) => err(e));
            return;
          } else {
            isMaster = false;
            dbg('disable the heartbeat');
            if (heartbeatTimer) clearTimeout(heartbeatTimer);
            heartbeatTimer = null;
          }
        }).catch((e) => err(e)).finally(() => {
          if (isMaster && !closing) {
            if (heartbeatTimer) clearTimeout(heartbeatTimer);
            heartbeatTimer = setTimeout(tick, nextHeartbeatDelay());
          }
        });
      };
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(tick, nextHeartbeatDelay());
    }).catch((e) => err(e));
  };

  async function startWorkerLoop() {
    try {
      for (const q of queues) {
        let orphan: string | null;
        do {
          orphan = await client.rPop(qprocessing(q));
          if (orphan) await client.lPush(qjobs(q), orphan);
        } while (orphan);
      }
    } catch (e) { err(e); }

    while (!stopping && isClientOpen()) {
      try {
        let res: string | null = null;
        let pickedQueue: string | null = null;
        const hasBlMove = typeof (client as any).blMove === 'function';
        if (hasBlMove) {
          for (const q of queues) {
            if (res) break;
            try {
              res = await (client as any).blMove(qjobs(q), qprocessing(q), 'RIGHT', 'LEFT', 0.2);
              if (res) pickedQueue = q;
            } catch (_) {}
          }
        } else {
          for (const q of queues) {
            if (res) break;
            res = await client.rPopLPush(qjobs(q), qprocessing(q));
            if (res) pickedQueue = q;
          }
          if (!res) await new Promise((r) => setTimeout(r, 250));
        }
        if (!res) continue;
        dbg('process ' + res);
        const job = JSON.parse(res, dateReviver) as Job | null;
        if (!job || !job.script) { if (isClientOpen()) await client.lRem(qprocessing(pickedQueue || 'default'), -1, res); continue; }
        if (!job.queue) job.queue = pickedQueue || 'default';
        await runProcessor(job, res, job.queue);
      } catch (e) { if (stopping) break; err(e); }
    }
  }

  function computeBackoff(job: Job) {
    const retry: any = job.retry || (job.options && (job.options as any).retry) || {};
    const attempt = job.attempt || 0;
    let base = 1000;
    let factor = 2;
    let maxDelay: number | undefined;
    if (typeof retry.backoff === 'number') base = retry.backoff;
    else if (retry.backoff && typeof retry.backoff === 'object') {
      if (typeof retry.backoff.delay === 'number') base = retry.backoff.delay;
      if (typeof retry.backoff.factor === 'number') factor = retry.backoff.factor;
      if (typeof retry.backoff.maxDelay === 'number') maxDelay = retry.backoff.maxDelay;
    }
    let delay = base * Math.pow(factor, Math.max(0, attempt));
    if (typeof maxDelay === 'number') delay = Math.min(delay, maxDelay);
    return delay;
  }

  async function runProcessor(job: Job, raw: string, queue: string) {
    let processor: ((job: Job, done?: (err?: any) => void) => any) | undefined;
    if (options && options.processors && options.processors[job.script]) processor = options.processors[job.script];
    else {
      const baseDir = options && options.scriptsDir ? path.resolve(options.scriptsDir) : null;
      const scriptPath = baseDir ? path.resolve(baseDir, job.script) : path.resolve(job.script);
      if (baseDir && !scriptPath.startsWith(baseDir + path.sep)) throw new Error('Refusing to load script outside scriptsDir');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      processor = require(scriptPath);
    }
    let finished = false;
    const onDone = async (e?: any) => {
      if (finished) return; finished = true;
      try {
        if (e) err('Job error:', e && e.stack ? e.stack : e);
        if (isClientOpen()) await client.lRem(qprocessing(queue || 'default'), -1, raw);
        if (e) {
          const retry = job.retry || (job.options && (job.options as any).retry);
          const maxAttempts = retry && typeof (retry as any).maxAttempts === 'number' ? (retry as any).maxAttempts : 0;
          job.attempt = (job.attempt || 0) + 1;
          if (maxAttempts > 0 && job.attempt <= maxAttempts) {
            const delay = computeBackoff(job);
            if (isClientOpen()) {
              await client.set(k('jobs', job.id), JSON.stringify(job));
              await client.set(k('jobs', job.id, 'retry'), '', { PX: delay });
            }
            events.emit('retryScheduled', job, delay);
          } else {
            const envelope = { job, error: e && (e.stack || e.message || String(e)), failedAt: new Date().toISOString() };
            if (isClientOpen()) await client.lPush(k('failed'), JSON.stringify(envelope));
            events.emit('failed', job, envelope.error);
            if (job.cron) scheduleJob(job);
          }
        } else {
          events.emit('succeeded', job);
          if (job.cron) scheduleJob(job);
        }
      } catch (finErr) { err('Error finalizing job', finErr); }
    };
    try {
      events.emit('started', job);
      if (!processor) throw new Error('Processor not found');
      const ret = (processor as any).length >= 2 ? processor(job, onDone) : processor(job);
      if (ret && typeof ret.then === 'function') ret.then(() => onDone(), onDone);
    } catch (e) { onDone(e); }
  }

  const addJob = (job: Job) => {
    const q = job.queue || 'default';
    if (isClientOpen()) client.rPush(qjobs(q), JSON.stringify(job)).catch((e) => console.error(e));
  };

  const getJob = (jobId: string, cb: (err: any, job?: Job | null) => void) => {
    client.get(k('jobs', jobId)).then((jobStr) => {
      try { cb(null, jobStr ? JSON.parse(jobStr, dateReviver) : null); }
      catch (e) { cb(e); }
    }).catch((e) => cb(e));
  };

  const removeJob = (jobId: string, cb: (err: any, res?: number) => void) => {
    client.del(k('jobs', jobId)).then((res) => cb && cb(null, res as any)).catch((e) => cb && cb(e));
  };

  const listJobsKey = (cb: (err: any, keys?: string[]) => void) => {
    (async () => {
      try {
        const keys: string[] = [];
        const anyClient: any = client;
        if (typeof anyClient.scanIterator === 'function') {
          for await (const key of anyClient.scanIterator({ MATCH: prefix + ':jobs:*', COUNT: 100 })) keys.push(key as string);
          cb(null, keys);
        } else {
          let cursor: any = '0';
          do {
            const res = await client.scan(cursor, { MATCH: prefix + ':jobs:*', COUNT: 100 });
            cursor = (res as any).cursor || (res as any)[0];
            const batch = (res as any).keys || (res as any)[1] || [];
            for (let i = 0; i < batch.length; i++) keys.push(batch[i]);
          } while (cursor !== '0' && cursor !== 0);
          cb(null, keys);
        }
      } catch (e) { cb(e); }
    })();
  };

  const scheduleJob = (job: Job) => {
    let currentDate = job.options && job.options.currentDate ? new Date(job.options.currentDate as any) : new Date();
    if (currentDate < new Date()) currentDate = new Date();
    const cronOpts: any = { currentDate, endDate: job.options && job.options.endDate ? new Date(job.options.endDate as any) : undefined };
    if (job.options && job.options.tz) cronOpts.tz = job.options.tz;
    const interval = parseExpression(job.cron as string, cronOpts);
    let nextDate: any;
    try { nextDate = interval.next(); } catch { nextDate = null; }
    const date = nextDate && typeof nextDate.toDate === 'function' ? nextDate.toDate() : nextDate;
    if (!date) return;
    dbg('Next schedule ' + date);
    const endTimeDelay = cronOpts.endDate ? Math.max(0, new Date(cronOpts.endDate).getTime() - Date.now()) : undefined;
    const delay = Math.max(0, new Date(date).getTime() - Date.now());
    const key = k('jobs', job.id);
    if (!isClientOpen()) return;
    const setPromise = typeof endTimeDelay === 'number' ? client.set(key, JSON.stringify(job), { PX: endTimeDelay }) : client.set(key, JSON.stringify(job));
    setPromise.then(() => {
      dbg('delay ' + delay);
      if (!isClientOpen()) return;
      return client.set(k('jobs', job.id, 'next'), '', { PX: delay }).then((res) => { dbg('Scheduling ' + res); events.emit('scheduled', job, date); });
    }).catch((e) => console.error(e));
  };

  const close = (cb?: (err?: any) => void) => {
    const p = Promise.resolve().then(() => {
      stopping = true;
      closing = true;
      if (heartbeatTimer) { clearTimeout(heartbeatTimer); heartbeatTimer = null; }
      isMaster = false;
    }).then(() => pubsub.pUnsubscribe().catch(() => { /* ignore */ })).then(() => Promise.allSettled([pubsub.quit(), client.quit()]) as any).then(() => {});
    if (cb) p.then(() => cb()).catch((e) => cb(e)); else return p;
  };

  master();

  return { scheduleJob, getJob, removeJob, listJobsKey, close, events } as Scheduler;
}

export = create;
