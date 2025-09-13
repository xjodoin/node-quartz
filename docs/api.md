# API

```ts
import create = require('node-quartz');

const quartz = create(options?: CreateOptions);

interface Scheduler {
  scheduleJob(job: Job): void;
  getJob(jobId: string, cb: (err: any, job?: Job | null) => void): void;
  removeJob(jobId: string, cb: (err: any, res?: number) => void): void;
  listJobsKey(cb: (err: any, keys?: string[]) => void): void;
  close(cb?: (err?: any) => void): Promise<void> | void;
  events: EventEmitter;
}
```

See README for detailed options and events.
