/* eslint-env mocha */
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { expect } = require('chai');
const { createClient } = require('redis');
const create = require('../lib/quartz');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('CLI defs integration', function () {
  this.timeout(45000);

  const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  let client;
  let prefix;
  let quartz;

  before(async () => {
    client = createClient({ url: REDIS_URL });
    await client.connect();
    try { await client.configSet('notify-keyspace-events', 'Ex'); } catch (e) { void e; }
  });

  beforeEach(async () => {
    prefix = `quartz:test:${Date.now()}:${Math.floor(Math.random() * 10000)}`;
    quartz = create({
      prefix,
      redis: { url: REDIS_URL },
      scriptsDir: path.join(__dirname, '..', 'test_scripts')
    });
  });

  afterEach(async () => {
    if (quartz && quartz.close) await quartz.close();
  });

  after(async () => { if (client) await client.quit(); });

  it('defs:add schedules a new job via CLI', async () => {
    const counterKey = `${prefix}:counters:cliadd`;
    const job = {
      id: `${prefix}:job-cliadd`,
      script: 'ok',
      cron: '*/1 * * * * *',
      data: { counterKey },
      options: { endDate: new Date(Date.now() + 3000) }
    };

    const tmpDir = path.join(__dirname, 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const jobPath = path.join(tmpDir, 'job-cliadd.json');
    fs.writeFileSync(jobPath, JSON.stringify(job));

    await new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [path.join(__dirname, '..', 'bin', 'quartz-cli.js'),
          'defs:add', '--file', jobPath, '--prefix', prefix, '--redis', REDIS_URL],
        { cwd: path.join(__dirname, '..') },
        (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || stdout || String(err)));
          resolve(undefined);
        }
      );
    });

    await sleep(3500);
    const count = parseInt((await client.get(counterKey)) || '0', 10);
    expect(count).to.be.greaterThan(0);
  });
});
