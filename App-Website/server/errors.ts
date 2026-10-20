/** An expected failure whose message is safe to show to the caller. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    /** A stable machine-readable reason the client can branch on, such as "email_unverified". */
    readonly code?: string,
  ) {
    super(message);
  }
}
