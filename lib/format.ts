export function formatPrice(kopecks: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: kopecks % 100 ? 2 : 0,
  }).format(kopecks / 100);
}
