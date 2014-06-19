# NodeJs Distributed and resilient job scheduling framework

## Installation

It's on NPM.

	npm install node-quartz

## Usage

```javascript

  var options = {
       scriptsDir : '/my/scripts/path',
       redis : {
            port : null,
            host: null,
            options : {}
       }
  };

  var quartz = require('node-quartz');
  
  var job = {
                id: 'job_id',
                script: 'scriptToRun',
                cron: '*/2 * * * *',
                options: {
                    currentDate: null,
                    endDate: null
                },
            };

  quartz.scheduleJob(job);
  

```  
  
## Requirement
  - Redis 2.8 



