import { Job } from '../types';

export interface JobStore {
  load(): Promise<Job[]>;
  list(): Promise<Job[]>;
  save(job: Job): Promise<void>;
  remove(jobId: string): Promise<void>;
}

