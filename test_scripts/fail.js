const { createClient } = require('redis');

module.exports = async function (job) {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const client = createClient({ url });
  await client.connect();
  try {
    if (!job || !job.data) throw new Error('Missing job.data');
    if (job.data.attemptsKey) {
      await client.incr(job.data.attemptsKey);
    }
  } finally {
    await client.quit();
  }
  throw new Error('Intentional failure');
};

