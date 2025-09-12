import * as fs from 'fs';
import * as path from 'path';
import { Job } from '../types';
import { JobStore } from './JobStore';

export class FileStore implements JobStore {
  private filePath: string;
  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }
  private read(): Job[] {
    if (!fs.existsSync(this.filePath)) return [];
    const txt = fs.readFileSync(this.filePath, 'utf8');
    if (!txt.trim()) return [];
    const arr = JSON.parse(txt);
    if (!Array.isArray(arr)) return [];
    return arr as Job[];
  }
  private write(jobs: Job[]) { fs.writeFileSync(this.filePath, JSON.stringify(jobs, null, 2)); }
  async load(): Promise<Job[]> { return this.list(); }
  async list(): Promise<Job[]> { return this.read(); }
  async save(job: Job): Promise<void> {
    const jobs = this.read();
    const idx = jobs.findIndex(j => j.id === job.id);
    if (idx >= 0) jobs[idx] = job; else jobs.push(job);
    this.write(jobs);
  }
  async remove(jobId: string): Promise<void> {
    const jobs = this.read().filter(j => j.id !== jobId);
    this.write(jobs);
  }
}

