# Usage

```js
const create = require('node-quartz');

const quartz = create({
  scriptsDir: '/path/to/scripts',
  prefix: 'quartz',
  queues: ['default'],
  redis: { url: process.env.REDIS_URL || 'redis://localhost:6379' }
});

const job = {
  id: 'example-job',
  script: 'myScript',
  cron: '*/10 * * * * *',
  data: { any: 'payload' },
  options: { endDate: new Date(Date.now() + 60_000) }
};

quartz.scheduleJob(job);
```

## Processors
Create `/path/to/scripts/myScript.js`:

```js
module.exports = async function(job) {
  console.log('processing', job.id, job.data);
};
```
