var quartz = require('lib/quartz');
var moment = require('moment');

quartz.scheduleJob({
    id: 'testId',
    script: __dirname + '/jobExample',
    data: 'test',
    cron: '*/10 * * * * *',
    options: {
        endDate: moment().add('seconds', 30).toDate()
    }
});