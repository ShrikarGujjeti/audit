"use client";

import { MediaGrid, type GridItem } from "./MediaGrid";

export function UndatedSection({ items, timeZone, onOpen }: {
  items: GridItem[];
  timeZone: string;
  onOpen: (mediaId: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="undated-heading" className="mb-16">
      <h2 id="undated-heading" className="mb-1 text-[22px] leading-[28px] text-[var(--tc-ink-primary)]">
        Undated
      </h2>
      <p className="mb-4 text-[13px] text-[var(--tc-ink-secondary)]">
        No capture time, shown by upload time.
      </p>
      <MediaGrid items={items} timeZone={timeZone} onOpen={onOpen} />
    </section>
  );
}
