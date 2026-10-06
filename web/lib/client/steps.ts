/** Fixed step list shown while a run is in flight; the server emits one event per step in this order. */
export function stepLabels(judge: boolean): readonly string[] {
  return [
    "Render 4 candidates",
    "Run baseline",
    "Run critique",
    "Run decomposition",
    "Run structured reasoning",
    ...(judge ? ["Score outputs with Jev"] : []),
    "Rank candidates",
  ];
}

export function progressPercent(doneCount: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round(((Math.min(doneCount, total - 1) + 0.5) / total) * 100));
}
