import { Job } from '../types';

export function computeBackoff(job: Job): number {
  const retry: any = job.retry || (job.options && (job.options as any).retry) || {};
  const attempt = job.attempt || 0;
  let base = 1000;
  let factor = 2;
  let maxDelay: number | undefined;
  if (typeof retry.backoff === 'number') {
    base = retry.backoff;
  } else if (retry.backoff && typeof retry.backoff === 'object') {
    if (typeof retry.backoff.delay === 'number') base = retry.backoff.delay;
    if (typeof retry.backoff.factor === 'number') factor = retry.backoff.factor;
    if (typeof retry.backoff.maxDelay === 'number') maxDelay = retry.backoff.maxDelay;
  }
  let delay = base * Math.pow(factor, Math.max(0, attempt));
  if (typeof maxDelay === 'number') delay = Math.min(delay, maxDelay);
  return delay;
}

