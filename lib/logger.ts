import pino, { type DestinationStream } from "pino";
export function makeLogger(destination?: DestinationStream) {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: [
          "email",
          "name",
          "token",
          "accessKey",
          "externalId",
          "*.accessKey",
          "*.externalId",
          "req.body.link",
          "password",
          "authorization",
          "req.headers.authorization",
          "req.headers.cookie",
        ],
        censor: "[REDACTED]",
      },
    },
    destination,
  );
}
export const logger = makeLogger();
