"use client";

import { useState } from "react";
import { MESSAGES } from "@/modules/media/upload/messages";
import { summarizeQueue } from "@/modules/media/upload/summary";
import type { UploadItem, UploadQueue, UploadSnapshot } from "@/modules/media/upload/types";

const BTN =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

function rowStatus(item: UploadItem): string {
  switch (item.status) {
    case "queued":
      return "Waiting";
    case "requesting":
      return "Getting ready";
    case "uploading":
      return item.progress === null ? "Uploading" : `Uploading ${Math.round(item.progress * 100)}%`;
    case "confirming":
      return "Finishing up";
    case "done":
      return "Added";
    case "cancelled":
      return "Cancelled";
    case "failed":
    case "rejected":
      return item.message ?? MESSAGES.generic;
  }
}

function Row({ item, queue }: { item: UploadItem; queue: UploadQueue }) {
  const canCancel = item.status === "queued" || item.status === "uploading";
  const canDismiss = item.status === "rejected" || item.status === "cancelled" || item.status === "failed";
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-gray-900">{item.fileName}</p>
        <p className={`text-xs ${item.status === "failed" || item.status === "rejected" ? "text-red-700" : "text-gray-500"}`}>
          {rowStatus(item)}
        </p>
        {item.status === "uploading" ? (
          // Native <progress>: not a live region, so percentages are not announced.
          <progress
            className="mt-1 h-1 w-full"
            aria-label={`Upload progress for ${item.fileName}`}
            {...(item.progress === null ? {} : { value: item.progress, max: 1 })}
          />
        ) : null}
      </div>
      {item.status === "failed" ? (
        <button type="button" className={BTN} onClick={() => queue.retry(item.id)} aria-label={`Try again: ${item.fileName}`}>
          Try again
        </button>
      ) : null}
      {canCancel ? (
        <button type="button" className={BTN} onClick={() => queue.cancel(item.id)} aria-label={`Cancel: ${item.fileName}`}>
          Cancel
        </button>
      ) : null}
      {canDismiss ? (
        <button type="button" className={BTN} onClick={() => queue.dismiss(item.id)} aria-label={`Dismiss: ${item.fileName}`}>
          Dismiss
        </button>
      ) : null}
    </li>
  );
}

export function UploadTray({
  queue,
  snapshot,
  tripId,
  tripName,
}: {
  queue: UploadQueue;
  snapshot: UploadSnapshot;
  tripId: string;
  tripName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { items, sessionEnded } = snapshot;
  if (items.length === 0) return null;

  const s = summarizeQueue(items);
  const allAdded = !s.isActive && s.failed === 0 && s.done > 0;

  return (
    <section
      aria-label="Adding memories"
      className="fixed inset-x-4 bottom-4 z-40 rounded-xl border border-gray-200 bg-white text-gray-900 shadow-lg sm:left-auto sm:right-4 sm:w-96"
      style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          className={`${BTN} flex-1 justify-between`}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span>{s.headline}</span>
          <span aria-hidden="true">{expanded ? "▾" : "▴"}</span>
        </button>
        {!s.isActive ? (
          <button type="button" className={BTN} onClick={() => queue.clearFinished()}>
            Close
          </button>
        ) : null}
      </div>

      {/* Polite summary only on state changes (not per percent). */}
      <p role="status" className="sr-only">
        {s.headline}
      </p>

      {s.isActive ? <p className="px-3 pb-2 text-xs text-gray-600">{MESSAGES.keepOpen}</p> : null}
      {allAdded ? (
        <p className="px-3 pb-2 text-sm text-gray-700">Added. Everyone in {tripName} can see these.</p>
      ) : null}

      {sessionEnded ? (
        <p role="alert" className="px-3 pb-2 text-sm text-red-700">
          {MESSAGES.sessionEnded}{" "}
          <a className="underline" href={`/login?redirectTo=${encodeURIComponent(`/trips/${tripId}`)}`}>
            Sign in
          </a>
        </p>
      ) : s.failed > 0 && !s.isActive ? (
        <p role="alert" className="px-3 pb-2 text-sm text-red-700">
          {s.headline}. Open the list to try again.
        </p>
      ) : null}

      {expanded ? (
        <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto border-t border-gray-100">
          {items.map((item) => (
            <Row key={item.id} item={item} queue={queue} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
