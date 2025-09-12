const { createClient } = require('redis');

module.exports = async function (job) {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const client = createClient({ url });
  await client.connect();
  try {
    if (!job || !job.data || !job.data.counterKey) throw new Error('Missing counterKey');
    await client.incr(job.data.counterKey);
  } finally {
    await client.quit();
  }
};

