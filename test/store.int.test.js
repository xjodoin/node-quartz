/* eslint-env mocha */
const path = require('path');
// const fs = require('fs');
const { expect } = require('chai');
const { createClient } = require('redis');
const create = require('../lib/quartz');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('job store integration', function () {
  this.timeout(30000);

  const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  let client;
  let prefix;

  before(async () => {
    client = createClient({ url: REDIS_URL });
    await client.connect();
    try { await client.configSet('notify-keyspace-events', 'Ex'); } catch (e) { void e; }
  });

  beforeEach(async () => {
    prefix = `quartz:test:${Date.now()}:${Math.floor(Math.random() * 10000)}`;
  });

  after(async () => { if (client) await client.quit(); });

  it('loads definitions from memory store and schedules', async () => {
    const counterKey = `${prefix}:counters:mem`;
    const job = {
      id: `${prefix}:job-mem`,
      script: 'ok',
      cron: '*/1 * * * * *',
      data: { counterKey },
      options: { endDate: new Date(Date.now() + 2000) }
    };

    const quartz = create({
      prefix,
      redis: { url: REDIS_URL },
      scriptsDir: path.join(__dirname, '..', 'test_scripts'),
      store: { type: 'memory', jobs: [job] }
    });

    await sleep(2500);
    const count = parseInt((await client.get(counterKey)) || '0', 10);
    await quartz.close();
    expect(count).to.be.greaterThan(0);
  });

  it('reacts to defs:add via pubsub', async () => {
    const counterKey = `${prefix}:counters:add`;
    const job = {
      id: `${prefix}:job-add`,
      script: 'ok',
      cron: '*/1 * * * * *',
      data: { counterKey },
      options: { endDate: new Date(Date.now() + 2000) }
    };

    const quartz = create({
      prefix,
      redis: { url: REDIS_URL },
      scriptsDir: path.join(__dirname, '..', 'test_scripts')
    });

    const defsIndex = `${prefix}:defs:index`;
    const defKey = `${prefix}:defs:${job.id}`;
    const defsChannel = `${prefix}:defs:events`;
    await client.set(defKey, JSON.stringify(job));
    await client.sAdd(defsIndex, job.id);
    await client.publish(defsChannel, JSON.stringify({ action: 'upsert', id: job.id }));

    await sleep(2500);
    const count = parseInt((await client.get(counterKey)) || '0', 10);
    await quartz.close();
    expect(count).to.be.greaterThan(0);
  });
});
