import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AppEnv } from "../env";
import { assertDevelopment } from "../providers";
export interface MailTransport {
  send(message: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<string>;
}
export class LogMailTransport implements MailTransport {
  constructor(private readonly directory = "tmp/mails") {}
  async send(message: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }) {
    z.object({
      to: z.email(),
      subject: z.string().min(1),
      text: z.string().min(1),
      html: z.string().min(1).optional(),
    })
      .strict()
      .parse(message);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    await writeFile(
      join(this.directory, `${id}.json`),
      JSON.stringify(message),
      { mode: 0o600, flag: "wx" },
    );
    // No recipient addresses or magic links in stdout.
    console.info(JSON.stringify({ event: "mail_logged", id }));
    return id;
  }
}
export class SmtpMailTransport implements MailTransport {
  constructor(private readonly env: AppEnv) {}
  async send(message: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }) {
    z.object({
      to: z.email(),
      subject: z.string().min(1),
      text: z.string().min(1),
      html: z.string().min(1).optional(),
    })
      .strict()
      .parse(message);
    const transport = nodemailer.createTransport({
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      secure: this.env.SMTP_PORT === 465,
      requireTLS:
        this.env.NODE_ENV === "production" && this.env.SMTP_PORT !== 465,
      auth: this.env.SMTP_USER
        ? { user: this.env.SMTP_USER, pass: this.env.SMTP_PASSWORD }
        : undefined,
      tls: { minVersion: "TLSv1.2" },
      connectionTimeout: 10000,
      socketTimeout: 10000,
    });
    try {
      const result = await transport.sendMail({
        from: this.env.MAIL_FROM,
        ...message,
      });
      return result.messageId;
    } finally {
      transport.close();
    }
  }
}
export function createMailTransport(env: AppEnv): MailTransport {
  if (env.MAIL_TRANSPORT === "smtp") return new SmtpMailTransport(env);
  assertDevelopment(env);
  return new LogMailTransport();
}
