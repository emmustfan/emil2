export class AuthError extends Error {
  constructor(
    public readonly code:
      | "invalid"
      | "rate"
      | "forbidden"
      | "unauthorized"
      | "conflict"
      | "unavailable",
    public readonly status = 400,
  ) {
    super(code);
    this.name = "AuthError";
  }
}
