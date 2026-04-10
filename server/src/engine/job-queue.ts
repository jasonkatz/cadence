import { logger } from "../utils/logger";

export interface JobData {
  workflowId: string;
  iteration: number;
  stepIds: Record<string, string>;
  failureContext?: string;
  e2eEvidence?: string;
}

interface QueuedJob {
  id: string;
  name: string;
  data: JobData;
  expireMs: number;
}

type JobHandler = (data: JobData) => Promise<void>;

export class JobQueue {
  private queues = new Map<string, QueuedJob[]>();
  private active = new Set<string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private handlers = new Map<string, JobHandler>();
  private running = false;
  private jobCounter = 0;

  registerHandler(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  enqueue(name: string, data: JobData, expireMs: number): string {
    const id = `job-${++this.jobCounter}-${Date.now()}`;
    const job: QueuedJob = { id, name, data, expireMs };
    const workflowId = data.workflowId;

    if (!this.queues.has(workflowId)) {
      this.queues.set(workflowId, []);
    }
    this.queues.get(workflowId)!.push(job);

    if (this.running) {
      this.processWorkflow(workflowId);
    }

    return id;
  }

  cancel(workflowId: string): void {
    this.queues.delete(workflowId);
    const timer = this.timers.get(workflowId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(workflowId);
    }
  }

  start(): void {
    this.running = true;
    // Process any already-queued workflows
    for (const workflowId of this.queues.keys()) {
      this.processWorkflow(workflowId);
    }
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private async processWorkflow(workflowId: string): Promise<void> {
    if (this.active.has(workflowId)) return;

    const queue = this.queues.get(workflowId);
    if (!queue || queue.length === 0) {
      this.queues.delete(workflowId);
      return;
    }

    this.active.add(workflowId);
    const job = queue.shift()!;

    const handler = this.handlers.get(job.name);
    if (!handler) {
      logger.error(`No handler for job type: ${job.name}`);
      this.active.delete(workflowId);
      this.processWorkflow(workflowId);
      return;
    }

    // Set expiration timer
    const timer = setTimeout(() => {
      logger.error(`Job ${job.id} expired after ${job.expireMs}ms`, {
        jobType: job.name,
        workflowId,
      });
    }, job.expireMs);
    this.timers.set(workflowId, timer);

    try {
      logger.info("Processing job", {
        jobType: job.name,
        jobId: job.id,
        workflowId,
      });
      await handler(job.data);
    } catch (error) {
      logger.error("Job handler error", {
        jobType: job.name,
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
      this.timers.delete(workflowId);
      this.active.delete(workflowId);

      if (this.running) {
        this.processWorkflow(workflowId);
      }
    }
  }
}
