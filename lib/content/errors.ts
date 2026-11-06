import type { ParseError } from "./parse";
export class ContentError extends Error {
  constructor(
    message: string,
    public readonly status = 422,
    public readonly issues: ParseError[] = [],
    public readonly code = "validation",
  ) {
    super(message);
    this.name = "ContentError";
  }
}
