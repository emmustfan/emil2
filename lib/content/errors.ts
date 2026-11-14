import type { ParseError } from "./parse";
import type { ContentFieldIssue } from "./field-errors";
export class ContentError extends Error {
  constructor(
    message: string,
    public readonly status = 422,
    public readonly issues: ParseError[] = [],
    public readonly code = "validation",
    public readonly fields: ContentFieldIssue[] = [],
  ) {
    super(message);
    this.name = "ContentError";
  }
}
