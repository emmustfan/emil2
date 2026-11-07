const patterns = [
  /[\p{L}\d.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/iu,
  /(?:\+?7|8)[\s().-]*(?:\d[\s().-]*){10}(?!\d)/u,
  /(?<!\d)\+\d[\d\s().-]{8,}\d/u,
  /(?<!\d)\(?\d{3}\)?[ .-]*\d{3}[ .-]*\d{2}[ .-]*\d{2}(?!\d)/u,
  /(?<!\d)\d{3}[- ]?\d{3}[- ]?\d{3}[ -]?\d{2}(?!\d)/u,
  /(?<!\d)\d{2}[ -]?\d{2}[ -]+\d{6}(?!\d)/u,
  /(?<!\d)\d{2}[./-]\d{2}[./-](?:19|20)\d{2}(?!\d)/u,
  /(?:дата рождения|родил[а-я]*|д\.\s*р\.)\s*[:—-]?\s*\d{1,2}\s+[а-я]+\s+(?:19|20)\d{2}/iu,
  /(?:меня зовут|мо[её] имя|пациент(?:ка)?\s*:)\s*[\p{L}-]+/iu,
];
export function containsPersonalData(text: string) {
  return patterns.some((pattern) => pattern.test(text.normalize("NFKC")));
}
export function redactPersonalData(text: string) {
  let result = text.normalize("NFKC");
  for (const pattern of patterns)
    result = result.replace(
      new RegExp(pattern.source, pattern.flags + "g"),
      "[данные удалены]",
    );
  return result;
}
