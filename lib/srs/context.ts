import { parseTopic } from "../content/parse";
export function gapContext(markdown: string, gapKey: string, answer: string) {
  const gap = parseTopic(markdown).gaps.find((g) => g.gapKey === gapKey);
  return gap ? `${gap.beforeGap}${answer}${gap.afterGap}`.trim() : null;
}
