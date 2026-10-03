/**
 * Pure justified-row layout math (section 5: "justified rows at true
 * aspect ratios, never cropped, with a 2px gap"). No React/DOM — operates
 * on plain numbers so it's independently testable and portable.
 */
import { LAST_ROW_MAX_STRETCH, clampAspectRatio, type SanitizedDimensions } from "./timeline";

export type LayoutInput = {
  key: string;
  aspectRatio: number; // already clamped via clampAspectRatio
  /** Width multiplier for the featured-tile rule (section 5); 1 = normal. */
  featuredMultiplier: number;
};

export type LayoutTile = {
  key: string;
  widthPx: number;
  heightPx: number;
};

export type LayoutRow = {
  tiles: LayoutTile[];
  heightPx: number;
};

/** Packs a row of items (each already carrying its featured multiplier) to
 * exactly fill containerWidth at a single shared row height, respecting
 * each item's own aspect ratio (never cropped — only the common height is
 * shared, same as any justified photo grid). */
function packRow(items: LayoutInput[], containerWidth: number, gapPx: number): LayoutRow {
  const gapsWidth = gapPx * Math.max(0, items.length - 1);
  const availableWidth = containerWidth - gapsWidth;
  // sum of (aspectRatio * featuredMultiplier) at height=1 gives the total
  // "unit width" the row would occupy at a shared height of 1px.
  const unitWidth = items.reduce((sum, i) => sum + i.aspectRatio * i.featuredMultiplier, 0);
  const heightPx = unitWidth > 0 ? availableWidth / unitWidth : 0;
  const tiles = items.map((i) => ({
    key: i.key,
    widthPx: Math.max(1, Math.round(i.aspectRatio * i.featuredMultiplier * heightPx)),
    heightPx: Math.max(1, Math.round(heightPx)),
  }));
  return { tiles, heightPx: Math.max(1, Math.round(heightPx)) };
}

export function computeJustifiedRows(
  items: LayoutInput[],
  containerWidth: number,
  targetRowHeight: number,
  gapPx: number
): LayoutRow[] {
  const rows: LayoutRow[] = [];
  let current: LayoutInput[] = [];
  let currentUnitWidth = 0; // sum of aspectRatio*multiplier at height=targetRowHeight

  for (const item of items) {
    current.push(item);
    currentUnitWidth += item.aspectRatio * item.featuredMultiplier;
    const widthAtTarget = currentUnitWidth * targetRowHeight + gapPx * (current.length - 1);
    if (widthAtTarget >= containerWidth) {
      rows.push(packRow(current, containerWidth, gapPx));
      current = [];
      currentUnitWidth = 0;
    }
  }

  if (current.length > 0) {
    // Last, possibly-incomplete row: stretch to fill, but cap the stretch
    // (section 5: "the last row is not stretched beyond about 1.3x") by
    // falling back to the natural (unstretched) height when stretching
    // would exceed the cap.
    const naturalRow = packRow(current, containerWidth, gapPx);
    const stretchRatio = naturalRow.heightPx / targetRowHeight;
    if (stretchRatio > LAST_ROW_MAX_STRETCH) {
      const gapsWidth = gapPx * Math.max(0, current.length - 1);
      const tiles = current.map((i) => ({
        key: i.key,
        widthPx: Math.max(1, Math.round(i.aspectRatio * i.featuredMultiplier * targetRowHeight)),
        heightPx: Math.max(1, Math.round(targetRowHeight)),
      }));
      // Not stretched to fill — left-aligned, trailing gap is acceptable
      // for the final row rather than distorting every tile in it.
      void gapsWidth;
      rows.push({ tiles, heightPx: Math.max(1, Math.round(targetRowHeight)) });
    } else {
      rows.push(naturalRow);
    }
  }

  return rows;
}

/** Null/invalid dimensions reserve a stable 4:3-ish box rather than
 * reflowing on load (section 5). */
export function layoutAspectRatioFor(dimensions: SanitizedDimensions): number {
  return clampAspectRatio(dimensions);
}
