import type { Rating } from "./schedule";
export type ReviewSummary = {
  dueCount: number;
  reviewedToday: number;
  newShownToday: number;
  newDailyLimit: number;
  newWaiting: number;
  nextDueAt: string | null;
  timeZone: string;
};
export type ReviewFront = {
  id: string;
  revision: number;
  topicVersion: number;
  source: "GAP" | "QUESTION";
  prompt: string;
  subjectTitle: string;
  topicTitle: string;
};
export type ReviewBack = {
  id: string;
  revision: number;
  topicVersion: number;
  answers: string[];
  alternatives: string[];
  explanation: string;
  context: string | null;
  lessonHref: string;
  choices: { rating: Rating; label: string; dueAt: string }[];
};
export type ReviewQueue = { cards: ReviewFront[]; summary: ReviewSummary };
