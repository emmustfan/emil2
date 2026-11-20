export type WatchRange = [number, number];

export function mergeWatchRanges(
  previous: WatchRange[],
  incoming: WatchRange[],
  duration: number | null,
) {
  const max = duration ?? 86400;
  const valid = (range: WatchRange) =>
    Number.isFinite(range[0]) &&
    Number.isFinite(range[1]) &&
    range[0] >= 0 &&
    range[1] > range[0] &&
    range[1] <= max + 5;
  const sorted = [
    ...previous.filter(valid),
    ...incoming.filter((r) => valid(r) && r[1] - r[0] <= 20),
  ]
    .map(([from, to]): WatchRange => [from, Math.min(to, max)])
    .filter(([from, to]) => from < to)
    .sort((a, b) => a[0] - b[0]);
  const ranges: WatchRange[] = [];
  for (const [from, to] of sorted) {
    const last = ranges.at(-1);
    if (last && last[1] >= from) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }
  return {
    ranges,
    watchedSec: Math.floor(
      ranges.reduce((sum, [from, to]) => sum + to - from, 0),
    ),
  };
}

export function videoCompleted(
  watchedSec: number,
  duration: number | null,
  threshold: number,
) {
  return duration !== null && watchedSec >= duration * threshold;
}
