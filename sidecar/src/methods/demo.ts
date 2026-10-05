import { emit, log } from "../protocol.js";

const STEPS = [
  "Preparing the workspace",
  "Reading project context",
  "Writing a summary",
] as const;

const STEP_MS = 900;

interface Job {
  cancelled: boolean;
}

const jobs = new Map<string, Job>();
let counter = 0;

/** Starts a job that does nothing useful, slowly, so the live event path is real. */
export function start(params: Record<string, unknown>): { jobId: string } {
  const kind = typeof params["kind"] === "string" ? params["kind"] : "demo";
  const jobId = `job-${++counter}`;
  const job: Job = { cancelled: false };
  jobs.set(jobId, job);

  void runJob(jobId, kind, job);
  return { jobId };
}

export function cancel(params: Record<string, unknown>): { cancelled: boolean } {
  const jobId = typeof params["jobId"] === "string" ? params["jobId"] : "";
  const job = jobs.get(jobId);
  if (!job) return { cancelled: false };
  job.cancelled = true;
  return { cancelled: true };
}

async function runJob(jobId: string, kind: string, job: Job): Promise<void> {
  log(`starting ${kind} job ${jobId}`);
  emit("job:event", { jobId, kind: "started", totalSteps: STEPS.length, ts: Date.now() });

  for (const [index, label] of STEPS.entries()) {
    await sleep(STEP_MS);

    if (job.cancelled) {
      jobs.delete(jobId);
      emit("job:event", { jobId, kind: "cancelled", step: index + 1, ts: Date.now() });
      log(`job ${jobId} cancelled at step ${index + 1}`);
      return;
    }

    emit("job:event", {
      jobId,
      kind: "step",
      step: index + 1,
      totalSteps: STEPS.length,
      label,
      ts: Date.now(),
    });
  }

  jobs.delete(jobId);
  emit("job:event", { jobId, kind: "finished", totalSteps: STEPS.length, ts: Date.now() });
  log(`job ${jobId} finished`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
