var create = require('lib/quartz');
var options = process.env.REDIS_URL ? { redis: { url: process.env.REDIS_URL } } : {};
options.prefix = 'quartz:test';
var quartz = create(options);

quartz.scheduleJob({
    id: 'testId',
    script: __dirname + '/jobExample',
    data: 'test',
    cron: '*/10 * * * * *',
    options: {
        endDate: new Date(Date.now() + 30 * 1000)
    }
});

// Shut down after 35s so `npm test` exits
setTimeout(function () {
    Promise.resolve()
        .then(function () { return quartz.close(); })
        .then(function () { process.exit(0); })
        .catch(function () { process.exit(1); });
}, 35 * 1000);
