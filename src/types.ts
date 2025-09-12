import { EventEmitter } from 'events';

export interface RedisOptions {
  url?: string;
  host?: string;
  port?: number;
  database?: number;
  options?: Record<string, any>;
}

export interface RetryOptions {
  maxAttempts?: number;
  backoff?: number | {
    delay: number;
    factor?: number;
    maxDelay?: number;
  };
}

export interface JobOptions {
  currentDate?: Date | string | number;
  endDate?: Date | string | number;
  tz?: string;
  retry?: RetryOptions;
}

export interface Job<T = any> {
  id: string;
  script: string;
  cron?: string;
  data?: T;
  queue?: string;
  options?: JobOptions;
  retry?: RetryOptions;
  attempt?: number;
}

export interface LoggerLike {
  debug?: (...args: any[]) => void;
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
}

export interface JobStore {
  load(): Promise<Job[]>;
  list(): Promise<Job[]>;
  save(job: Job): Promise<void>;
  remove(jobId: string): Promise<void>;
}

export interface StoreOptions {
  type: 'memory' | 'file' | 'custom';
  jobs?: Job[]; // for memory store
  path?: string; // for file store
  impl?: JobStore; // for custom store
}

export interface CreateOptions {
  scriptsDir?: string;
  prefix?: string;
  redis?: RedisOptions;
  logger?: LoggerLike;
  queues?: string[];
  heartbeat?: { intervalMs?: number; jitterMs?: number };
  processors?: Record<string, (job: Job, done?: (err?: any) => void) => any>;
  store?: StoreOptions;
}

export interface Scheduler {
  scheduleJob(job: Job): void;
  getJob(jobId: string, cb: (err: any, job?: Job | null) => void): void;
  removeJob(jobId: string, cb: (err: any, res?: number) => void): void;
  listJobsKey(cb: (err: any, keys?: string[]) => void): void;
  close(cb?: (err?: any) => void): Promise<void> | void;
  events: EventEmitter;
}
