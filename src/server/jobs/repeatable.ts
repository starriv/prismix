/**
 * Shared BullMQ repeatable-job helpers.
 */
import type { Queue, RepeatableJob } from "bullmq";
import type { Logger } from "pino";

interface RemoveStaleOptions {
  jobName: string;
  repeatJobId: string;
  everyMs: number;
  log: Logger;
  /** Human label for the log message, e.g. "top-up expiry". */
  label: string;
}

/**
 * Drop any repeatable job whose interval no longer matches the configured one.
 * BullMQ keys repeatables by their `every`, so changing the interval on redeploy
 * would otherwise leave the old schedule running alongside the new one.
 */
export async function removeStaleRepeatableJobs(
  queue: Queue,
  { jobName, repeatJobId, everyMs, log, label }: RemoveStaleOptions,
): Promise<void> {
  const repeatableJobs: RepeatableJob[] = await queue.getRepeatableJobs();
  const expectedEvery = String(everyMs);
  for (const job of repeatableJobs) {
    if (job.name !== jobName) continue;
    if (job.id !== repeatJobId) continue;
    if (job.every === expectedEvery) continue;

    await queue.removeRepeatableByKey(job.key);
    log.info(
      { repeatKey: job.key, previousEvery: job.every, nextEvery: expectedEvery },
      `Removed stale ${label} repeatable job`,
    );
  }
}
