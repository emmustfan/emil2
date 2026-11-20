export function videoMethod(
  progress: { selfReported: boolean; watchedSec: number } | null | undefined,
) {
  if (progress?.selfReported) return "Самоотметка";
  return progress?.watchedSec ? "По плееру" : "Не смотрел";
}

export function videoCoverage(watchedSec: number, durationSec: number | null) {
  return durationSec ? Math.min(1, watchedSec / durationSec) : null;
}
