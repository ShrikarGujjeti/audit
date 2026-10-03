"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { computeJustifiedRows, layoutAspectRatioFor, type LayoutInput } from "@/modules/media/justifiedLayout";
import { MediaTile, type MediaTileData } from "./MediaTile";
import { useSignedUrls } from "@/modules/media/useSignedUrls";
import type { SanitizedDimensions } from "@/modules/media/timeline";

export type GridItem = {
  data: MediaTileData;
  dimensions: SanitizedDimensions;
  featured: boolean;
};

const TARGET_ROW_HEIGHT = 200; // [H], mobile starting value per spec section 5
const GAP_PX = 2;
const FEATURED_MULTIPLIER = 1.8; // [H], within the spec's 1.6-2x range
const VISIBLE_ROOT_MARGIN = "800px 0px"; // load a bit before entering the viewport

export function MediaGrid({
  items,
  timeZone,
  onOpen,
}: {
  items: GridItem[];
  timeZone: string;
  onOpen: (mediaId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const { get, ensure } = useSignedUrls();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setContainerWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(() => {
    if (containerWidth === 0) return [];
    const layoutInputs: LayoutInput[] = items.map((item) => ({
      key: item.data.id,
      aspectRatio: layoutAspectRatioFor(item.dimensions),
      featuredMultiplier: item.featured ? FEATURED_MULTIPLIER : 1,
    }));
    return computeJustifiedRows(layoutInputs, containerWidth, TARGET_ROW_HEIGHT, GAP_PX);
  }, [items, containerWidth]);

  const byId = useMemo(() => new Map(items.map((i) => [i.data.id, i])), [items]);

  // Visible-window tracking: a single IntersectionObserver watches every
  // tile wrapper; ids that intersect get batched into one ensure() call.
  const pendingRef = useRef<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute("data-media-id");
            if (id) {
              pendingRef.current.add(id);
              changed = true;
            }
          }
        }
        if (changed) {
          const ids = Array.from(pendingRef.current);
          pendingRef.current.clear();
          void ensure(ids);
        }
      },
      { rootMargin: VISIBLE_ROOT_MARGIN }
    );
    return () => observerRef.current?.disconnect();
  }, [ensure]);

  function registerTile(node: HTMLDivElement | null) {
    if (node && observerRef.current) observerRef.current.observe(node);
  }

  return (
    <div ref={containerRef} className="flex flex-col" style={{ gap: GAP_PX }}>
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex" style={{ gap: GAP_PX }}>
          {row.tiles.map((tile) => {
            const item = byId.get(tile.key);
            if (!item) return null;
            return (
              <div key={tile.key} ref={registerTile} data-media-id={tile.key}>
                <MediaTile
                  data={item.data}
                  url={get(tile.key)}
                  widthPx={tile.widthPx}
                  heightPx={tile.heightPx}
                  timeZone={timeZone}
                  onOpen={() => onOpen(tile.key)}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
