import type { AnswerType } from "../exercises";
// Public DTOs: never import editor DTOs into the lesson UI.
export type Actor =
  | { userId: string; demoSessionId?: never }
  | { userId?: never; demoSessionId: string };
export type Option = { id: string; text: string };
export type GapFeedback = {
  chosen: string;
  correct: boolean;
  answer: string;
  chosenValues: string[];
  correctValues: string[];
  explanation: string;
};
export type QuestionFeedback = {
  chosenIds: string[];
  correctIds: string[];
  chosenText: string | null;
  answerText: string | null;
  chosenId: string;
  correct: boolean;
  correctId: string;
  explanation: string;
  sourceBlockKey: string | null;
};
export type LessonGap = {
  answerType: AnswerType;
  blockKey: string;
  stem: string;
  id: string;
  options: Option[];
  feedback: GapFeedback | null;
};
export type LessonQuestion = {
  answerType: AnswerType;
  id: string;
  stem: string;
  options: Option[];
  feedback: QuestionFeedback | null;
};
export type LessonBlock = { blockKey: string; markdown: string };
export type LessonProgress = {
  answered: number;
  correct: number;
  total: number;
  bestScore: number | null;
  completed: boolean;
};
export type LessonTest = {
  runId: string | null;
  questions: LessonQuestion[];
  score: number | null;
  finished: boolean;
};
export type LessonReview = { cards: number; signedIn: boolean };
export type LessonData = {
  review: LessonReview | null;
  topicId: string;
  version: number;
  locked: boolean;
  blocks: LessonBlock[];
  gaps: LessonGap[];
  test: LessonTest | null;
  progress: LessonProgress | null;
  passThreshold: number;
};
