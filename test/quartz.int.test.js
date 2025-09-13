/* eslint-env mocha */
const path = require('path');
const { expect } = require('chai');
const { createClient } = require('redis');
const create = require('../lib/quartz');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('node-quartz integration', function () {
  this.timeout(30000);

  const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  let client;
  let prefix;

  before(async () => {
    client = createClient({ url: REDIS_URL });
    await client.connect();
    try {
      // Ensure keyspace notifications for expiry
      await client.configSet('notify-keyspace-events', 'Ex');
    } catch (e) {
      // Ignore if not permitted
    }
  });

  beforeEach(async () => {
    prefix = `quartz:test:${Date.now()}:${Math.floor(Math.random() * 10000)}`;
  });

  after(async () => {
    if (client) await client.quit();
  });

  it('processes a successful job', async () => {
    const counterKey = `${prefix}:counters:ok`;
    const quartz = create({
      prefix,
      redis: { url: REDIS_URL },
      scriptsDir: path.join(__dirname, '..', 'test_scripts')
    });

    const job = {
      id: `${prefix}:job-ok`,
      script: 'ok',
      cron: '*/1 * * * * *',
      data: { counterKey },
      options: { endDate: new Date(Date.now() + 2000) }
    };

    quartz.scheduleJob(job);

    await sleep(2500);

    const count = parseInt((await client.get(counterKey)) || '0', 10);
    await quartz.close();
    expect(count).to.be.greaterThan(0);
  });

  it('retries on failure and pushes to failed queue after attempts', async () => {
    const attemptsKey = `${prefix}:counters:fail_attempts`;
    const failedKey = `${prefix}:failed`;
    const quartz = create({
      prefix,
      redis: { url: REDIS_URL },
      scriptsDir: path.join(__dirname, '..', 'test_scripts')
    });

    const job = {
      id: `${prefix}:job-fail`,
      script: 'fail',
      cron: '*/1 * * * * *',
      data: { attemptsKey },
      retry: { maxAttempts: 2, backoff: { delay: 100, factor: 1 } },
      options: { endDate: new Date(Date.now() + 3000) }
    };

    quartz.scheduleJob(job);

    // Poll up to ~6s to account for CI scheduling latency
    let attempts = 0;
    let failedCount = 0;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      attempts = parseInt((await client.get(attemptsKey)) || '0', 10);
      failedCount = await client.lLen(failedKey);
      if (attempts >= 3 && failedCount >= 1) break;
      await sleep(200);
    }
    await quartz.close();

    expect(attempts).to.be.at.least(3); // initial + 2 retries
    expect(failedCount).to.be.at.least(1);
  });

  it('processes jobs across multiple queues', async () => {
    const cHigh = `${prefix}:counters:high`;
    const cLow = `${prefix}:counters:low`;
    const quartz = create({
      prefix,
      queues: ['high', 'low'],
      redis: { url: REDIS_URL },
      scriptsDir: path.join(__dirname, '..', 'test_scripts')
    });

    quartz.scheduleJob({
      id: `${prefix}:job-high`,
      script: 'ok',
      cron: '*/1 * * * * *',
      data: { counterKey: cHigh },
      queue: 'high',
      options: { endDate: new Date(Date.now() + 2000) }
    });

    quartz.scheduleJob({
      id: `${prefix}:job-low`,
      script: 'ok',
      cron: '*/1 * * * * *',
      data: { counterKey: cLow },
      queue: 'low',
      options: { endDate: new Date(Date.now() + 2000) }
    });

    await sleep(2500);

    const hi = parseInt((await client.get(cHigh)) || '0', 10);
    const lo = parseInt((await client.get(cLow)) || '0', 10);
    await quartz.close();
    expect(hi).to.be.greaterThan(0);
    expect(lo).to.be.greaterThan(0);
  });
});
