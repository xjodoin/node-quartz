'use strict';
var _ = require('lodash');
var redis = require('redis');
var os = require("os");
var cron = require('cron-parser');
var moment = require('moment-range');
var winston = require('winston');
var path = require('path');


function create(options) {

    var redis = options.redis;

    var client = redis.createClient(redis.port, redis.host, redis.options);
    var pubsub = redis.createClient(redis.port, redis.host, redis.options);


    function dateReviver(key, value) {
        if (typeof value === 'string') {
            var a = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)Z$/.exec(value);
            if (a) {
                return new Date(Date.UTC(+a[1], +a[2] - 1, +a[3], +a[4], +a[5], +a[6]));
            }
        }
        return value;
    };


    var isMaster = false;

// Subscribe to all expired events respirator will fire off
    pubsub.psubscribe('__keyevent@0__:expired');
    pubsub.psubscribe('__keyevent@0__:rpush');

// Actual listener for the expired event
    pubsub.on('pmessage', function (pattern, channel, message) {

        if (message.indexOf('quartz') === 0) {
            winston.debug('new event ', message);
            if (isMaster) {
                var key = message;
                var end = key.indexOf(':next');
                if (end > 0) {
                    var jobKey = key.substring(0, end);
                    client.get(jobKey, function (err, res) {
                        try {
                            addJob(JSON.parse(res, dateReviver));
                        } catch (err) {
                            winston.error(err);
                        }

                    });
                }
            }
            else if (message === 'quartz:master') {
                winston.debug('master expired try to get lock');
                master();
            }

            if (message === 'quartz:jobs') {
                winston.debug('new job');
                worker();
            }

        }

    });


    function master() {

        //try to become master
        var masterKey = 'quartz:master';
        client.set(masterKey, os.hostname(), 'NX', 'EX', 5, function (err, res) {
            if (res) {

                winston.debug('is now the master');
                isMaster = true;

                //check all job are scheduled
                listJobsKey(function (err, keys) {
                    _.forEach(keys, function (key) {
                        client.exists(key + ':next', function (err, exist) {
                            if (exist === 0) {
                                client.get(key, function (err, job) {
                                    try {
                                        job = JSON.parse(job, dateReviver);
                                        if (job.cron) {
                                            winston.debug('reschedule job ' + key);
                                            scheduleJob(job);
                                        }
                                    }
                                    catch (err) {
                                        winston.error(err);
                                    }

                                });
                            }
                        });
                    });
                });


                //keep the lock heartbeat to keep the master lock
                var heartbeatId = setInterval(function () {
                    winston.debug('Heartbeat');

                    client.get(masterKey, function (err, res) {
                        if (res === os.hostname()) {
                            winston.debug('is the master update the ttl');
                            client.expire(masterKey, 5);
                        }
                        else {
                            isMaster = false;
                            winston.debug('disable the heartbeat');
                            clearInterval(heartbeatId);
                        }

                    });

                }, 2000);
            }

        });

    };


    function worker() {
        winston.debug('check for work');

        client.rpoplpush('quartz:jobs', 'quartz:processing', function (err, res) {
            if (res) {
                winston.debug('process ' + res);
                var job = JSON.parse(res, dateReviver);
                if (job.script) {

                    var script = path.join(options.scriptsDir || '', job.script);
                    var processor = require(script);
                    processor(job, function done(err) {
                        winston.debug('job done');
                        client.lrem('quartz:processing', -1, res, function (err, res) {
                            if (job.cron) {
                                scheduleJob(job);
                            }
                        });
                    });
                }
            }
        });

    }


    function addJob(job) {
        client.rpush('quartz:jobs', JSON.stringify(job));
    }

    function getJob(jobId, callback) {
        client.get('quartz:jobs:' + jobId, function (err, job) {
            if (err) {
                callback(err);
            }
            else {
                callback(err, JSON.parse(job, dateReviver));
            }
        });
    };


    function removeJob(jobId, callback) {
        client.del('quartz:jobs:' + jobId, callback);
    };

    function listJobsKey(callback) {
        client.keys('quartz:jobs:*', callback);
    };

    function scheduleJob(job) {

        var currentDate = job.options.currentDate;

        if (moment(currentDate).isBefore(moment())) {
            currentDate = new Date();
        }

        var options = {
            currentDate: currentDate,
            endDate: job.options.endDate
        }

        var interval = cron.parseExpressionSync(job.cron, options);

        if (interval.hasNext()) {
            var date = interval.next();

            winston.debug('Next schedule ' + date);

            if (job.options && job.options.endDate) {
                var endTimeDelay = moment().range(new Date(), job.options.endDate).valueOf();
            }


            var delay = moment().range(new Date(), date).valueOf();

            var params = ['quartz:jobs:' + job.id, JSON.stringify(job)];

            if (endTimeDelay) {
                params.push('PX');
                params.push(endTimeDelay);
            }

            client.set(params, function (err, res) {

                //schedule it
                winston.debug('delay ' + delay);
                client.set('quartz:jobs:' + job.id + ':next', '', 'PX', delay, function (err, res) {
                    if (err) {
                        console.log(err);
                    }
                    winston.debug('Scheduling ' + res);
                });

            });

        }
    }


    master();

    return {
        scheduleJob: scheduleJob,
        getJob: getJob,
        removeJob: removeJob,
        listJobsKey: listJobsKey
    }

}


module.exports = create;