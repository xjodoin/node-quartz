import { Job } from '../types';
import { JobStore } from './JobStore';

export class MemoryStore implements JobStore {
  private jobs: Map<string, Job>;
  constructor(initial: Job[] = []) {
    this.jobs = new Map(initial.map(j => [j.id, j]));
  }
  async load(): Promise<Job[]> { return this.list(); }
  async list(): Promise<Job[]> { return Array.from(this.jobs.values()); }
  async save(job: Job): Promise<void> { this.jobs.set(job.id, job); }
  async remove(jobId: string): Promise<void> { this.jobs.delete(jobId); }
}

