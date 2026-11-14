// Deterministic lexical embeddings for offline tests, not a semantic medical model.
const stop = new Set(
  "как какой какая какое какие что это для или при про мне мой почему чтобы чем после если еще есть всё все the and of to is".split(
    " ",
  ),
);
export function terms(text: string) {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/ё/g, "е")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
    .filter((word) => word.length > 2 && !stop.has(word))
    .map((word) =>
      word.length > 5
        ? word.replace(
            /(?:иями|ами|ого|ему|ому|ение|ения|ии|ия|ие|ый|ий|ая|ое|ые|ов|ам|ах|ом|ем|а|я|ы|и|у|ю|е)$/u,
            "",
          )
        : word,
    );
}
