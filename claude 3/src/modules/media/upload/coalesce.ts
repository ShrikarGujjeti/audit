/**
 * Coalesces "media list changed" signals into few refreshes.
 *  - trigger(): schedules one refresh `delayMs` after the FIRST trigger of a burst;
 *    further triggers inside that window are absorbed (no endless debounce).
 *  - flush(): runs immediately if anything is pending (used when the queue drains).
 */
export function createRefreshCoalescer(
  run: () => void,
  opts: {
    delayMs: number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (h: unknown) => void;
  }
) {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let dirty = false;

  const fire = () => {
    timer = null;
    if (!dirty) return;
    dirty = false;
    run();
  };

  return {
    trigger() {
      dirty = true;
      if (timer === null) timer = setTimer(fire, opts.delayMs);
    },
    flush() {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      if (dirty) {
        dirty = false;
        run();
      }
    },
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      dirty = false;
    },
  };
}
