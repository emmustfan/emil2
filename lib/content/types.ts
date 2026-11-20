import type { ParsedTopic } from "./parse";
import type { AnswerType, GapExercises } from "../exercises";
export type ContentStatus = "DRAFT" | "REVIEW" | "PUBLISHED";
export type DraftState = "CLEAN" | "DRAFT" | "REVIEW";
export type SubjectDTO = {
  id: string;
  title: string;
  slug: string;
  shortDescription: string;
  descriptionMd: string | null;
  courses: number[];
  order: number;
  status: ContentStatus;
  seoTitle: string | null;
  seoDescription: string | null;
  editRevision: number;
};
export type SectionDTO = {
  id: string;
  subjectId: string;
  title: string;
  order: number;
  editRevision: number;
};
export type QuestionDTO = {
  publishedAt?: string | null;
  hasDraft?: boolean;
  answerType: AnswerType;
  acceptedAnswers: string[];
  id: string;
  topicId: string;
  stem: string;
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  explanation: string;
  sourceBlockKey: string | null;
  isDiagnostic: boolean;
  order: number;
  videoId?: string | null;
  atSec?: number | null;
  aiGenerated?: boolean;
  sourceQuote?: string | null;
  sourceSec?: number | null;
  sourceVideoId?: string | null;
};
export type VideoMetadata = {
  id: string;
  title: string;
  durationSec: number | null;
};
export type TopicDTO = {
  draftState: DraftState;
  draftUpdatedAt: string | null;
  draftUpdatedBy: { id: string; name: string | null } | null;
  published: PublishedTopicDTO | null;
  imageIds?: string[];
  videos?: VideoMetadata[];
  gapExercises: GapExercises;
  id: string;
  subjectId: string;
  sectionId: string | null;
  title: string;
  slug: string;
  order: number;
  isFree: boolean;
  contentMd: string;
  readingMinutes: number | null;
  authorName: string | null;
  reviewerName: string | null;
  referencesMd: string | null;
  needsExpertReview: boolean;
  reviewedAt: string | null;
  status: ContentStatus;
  version: number;
  editRevision: number;
  publishedAt: string | null;
  subject: { id: string; title: string; slug: string; status?: ContentStatus };
  questions: QuestionDTO[];
};

export type PublishedTopicDTO = {
  title: string;
  contentMd: string;
  gapExercises: GapExercises;
  readingMinutes: number | null;
  authorName: string | null;
  reviewerName: string | null;
  referencesMd: string | null;
  questions: QuestionDTO[];
};

export type RevisionSummary = {
  id: string;
  version: number;
  publishedAt: string;
  publishedBy: { id: string; name: string | null } | null;
};
export type RevisionDTO = RevisionSummary & {
  parsed: ParsedTopic;
  title: string;
  contentMd: string;
  gapExercises: GapExercises;
  questions: QuestionDTO[];
};
