import type { UploadItem } from "./types";

export type QueueSummary = {
  total: number; // everything that was meant to upload (excludes rejected/cancelled)
  done: number;
  failed: number;
  rejected: number;
  waiting: number;
  busy: number;
  isActive: boolean; // anything queued or in flight
  headline: string;
};

export function summarizeQueue(items: readonly UploadItem[]): QueueSummary {
  let done = 0, failed = 0, rejected = 0, waiting = 0, busy = 0, cancelled = 0;
  for (const i of items) {
    if (i.status === "done") done++;
    else if (i.status === "failed") failed++;
    else if (i.status === "rejected") rejected++;
    else if (i.status === "cancelled") cancelled++;
    else if (i.status === "queued") waiting++;
    else busy++;
  }
  const total = items.length - rejected - cancelled;
  const isActive = waiting + busy > 0;
  let headline: string;
  if (isActive) headline = `Adding ${Math.min(done + failed + 1, total)} of ${total}`;
  else if (failed > 0) headline = failed === 1 ? "1 couldn't be added" : `${failed} couldn't be added`;
  else if (done > 0) headline = done === 1 ? "Added 1" : `Added ${done}`;
  else headline = rejected > 0 ? "Nothing was added" : "";
  return { total, done, failed, rejected, waiting, busy, isActive, headline };
}
