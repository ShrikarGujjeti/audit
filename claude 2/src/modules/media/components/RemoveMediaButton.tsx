"use client";

import { useActionState, useState } from "react";
import { deleteMediaAction, type DeleteMediaState } from "@/modules/media/actions";
import { useMediaRefresh } from "@/modules/media/refresh";

const initialState: DeleteMediaState = {};

/** Presentation-only gate (section 15: "This is a presentation rule only.
 * The backend remains authoritative") — the actual authorization is
 * deleteMediaAction / media_delete_uploader_or_owner RLS (0007). */
export function RemoveMediaButton({
  mediaId,
  canRemove,
  onRemoved,
}: {
  mediaId: string;
  canRemove: boolean;
  onRemoved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, isPending] = useActionState(deleteMediaAction, initialState);
  const refresh = useMediaRefresh();

  if (!canRemove) return null;

  if (state.success && !isPending) {
    // Fire once; parent (viewer) should already be advancing/closing.
    queueMicrotask(() => {
      refresh();
      onRemoved();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-[var(--tc-danger)] px-3 py-2 text-sm font-medium text-[var(--tc-danger)]"
      >
        Remove
      </button>
    );
  }

  return (
    <div className="rounded-md border border-[var(--tc-danger)] p-3 text-sm">
      <p>Remove this photo for everyone in this trip? This can&rsquo;t be undone.</p>
      {state.error ? <p role="alert" className="mt-1 text-[var(--tc-danger)]">{state.error}</p> : null}
      <form action={formAction} className="mt-2 flex gap-2">
        <input type="hidden" name="mediaId" value={mediaId} />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-[var(--tc-danger)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {isPending ? "Removing…" : "Yes, remove"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="rounded-md border px-3 py-2 text-sm"
        >
          Cancel
        </button>
      </form>
    </div>
  );
}
