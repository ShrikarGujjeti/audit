export function TimeMarker({ instantMs, timeZone }: { instantMs: number; timeZone: string }) {
  const label = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(instantMs));

  return (
    <p className="mb-2 text-[13px] tabular-nums text-[var(--tc-ink-secondary)]" aria-hidden="true">
      {label}
    </p>
  );
}
