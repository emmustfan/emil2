// Public DTOs: never import editor DTOs into the lesson UI.
export type Actor =
  | { userId: string; demoSessionId?: never }
  | { userId?: never; demoSessionId: string };
export type Option = { id: string; text: string };
export type GapFeedback = { chosen: string; correct: boolean; answer: string };
export type QuestionFeedback = {
  chosenId: string;
  correct: boolean;
  correctId: string;
  explanation: string;
  sourceBlockKey: string | null;
};
export type LessonGap = {
  id: string;
  options: Option[];
  feedback: GapFeedback | null;
};
export type LessonQuestion = {
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
export type LessonData = {
  topicId: string;
  version: number;
  locked: boolean;
  blocks: LessonBlock[];
  gaps: LessonGap[];
  test: LessonTest | null;
  progress: LessonProgress | null;
  passThreshold: number;
};
