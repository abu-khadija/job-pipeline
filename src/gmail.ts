// Islam's personal Gmail through the Gmail API (OAuth refresh token from `npm run gmail:auth`).
// Scopes: send + read-only. The pipeline never deletes, archives or changes mail.
import { readFileSync } from "node:fs";
import path from "node:path";
import { google, type gmail_v1 } from "googleapis";

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"];

export interface Attachment {
  filename: string;
  path: string;
  mimeType: string;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
  attachments?: Attachment[];
  /** For a follow-up in the same conversation. */
  threadId?: string;
  inReplyTo?: string;
}

export interface MailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  messageId: string;
  text: string;
}

/** What the pipeline needs from a mailbox. Tests use a fake; production uses Gmail. */
export interface Mailbox {
  send(mail: OutgoingMail): Promise<{ id: string; threadId: string; messageId: string }>;
  thread(threadId: string): Promise<MailMessage[]>;
  search(query: string, max?: number): Promise<MailMessage[]>;
  /** The account's own address (to tell Islam's messages from replies). */
  me(): Promise<string>;
}

// Header values must not carry new lines (header injection) and non-ASCII needs encoding.
const header = (v: string) => {
  const one = v.replace(/[\r\n]+/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(one) ? one : `=?UTF-8?B?${Buffer.from(one, "utf8").toString("base64")}?=`;
};
const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();

/** Builds a raw RFC 2822 message (plain text + attachments) for the Gmail API. */
export function buildMime(mail: OutgoingMail, from: string, read: (p: string) => Buffer = (p) => readFileSync(p)): string {
  const boundary = `jp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const head = [
    `From: ${header(from)}`,
    `To: ${header(mail.to)}`,
    `Subject: ${header(mail.subject)}`,
    "MIME-Version: 1.0",
    ...(mail.inReplyTo ? [`In-Reply-To: ${header(mail.inReplyTo)}`, `References: ${header(mail.inReplyTo)}`] : []),
  ];
  const textPart = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap76(Buffer.from(mail.body, "utf8").toString("base64"))];
  if (!mail.attachments?.length) return [...head, ...textPart].join("\r\n");
  const parts = [`--${boundary}`, ...textPart];
  for (const a of mail.attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${a.mimeType}; name="${header(a.filename)}"`,
      `Content-Disposition: attachment; filename="${header(a.filename)}"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(read(a.path).toString("base64")),
    );
  }
  parts.push(`--${boundary}--`);
  return [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}

function decode(data?: string | null): string {
  return data ? Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "";
}

/** Plain text of a message: the text/plain part, else HTML with tags removed. */
export function messageText(payload?: gmail_v1.Schema$MessagePart): string {
  if (!payload) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: gmail_v1.Schema$MessagePart) => {
    if (p.mimeType === "text/plain" && p.body?.data) plain.push(decode(p.body.data));
    else if (p.mimeType === "text/html" && p.body?.data) html.push(decode(p.body.data));
    p.parts?.forEach(walk);
  };
  walk(payload);
  if (plain.length) return plain.join("\n");
  return html.join("\n").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function toMessage(m: gmail_v1.Schema$Message): MailMessage {
  const h = (name: string) => m.payload?.headers?.find((x) => x.name?.toLowerCase() === name)?.value ?? "";
  return {
    id: m.id ?? "",
    threadId: m.threadId ?? "",
    from: h("from"),
    subject: h("subject"),
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : "",
    messageId: h("message-id"),
    text: messageText(m.payload).slice(0, 8000),
  };
}

/** Days until a "Testing"-mode Google token expires (7 days after `npm run gmail:auth`); null if unknown. */
export function gmailDaysLeft(authAt: string | undefined, now: Date = new Date()): number | null {
  const t = Date.parse(authAt ?? "");
  return Number.isNaN(t) ? null : Math.floor((t + 7 * 86_400_000 - now.getTime()) / 86_400_000);
}

/** Google's "invalid_grant" means the sign-in expired or was revoked. Say what to do instead. */
function explain(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (/invalid_grant|token has been expired or revoked/i.test(msg)) {
    throw new Error("Gmail sign-in expired: run `npm run gmail:auth` again (takes a minute).");
  }
  throw err;
}

export class GmailMailbox implements Mailbox {
  private api: gmail_v1.Gmail;
  private address = "";

  constructor() {
    const { GMAIL_CLIENT_ID: id, GMAIL_CLIENT_SECRET: secret, GMAIL_REFRESH_TOKEN: token } = process.env;
    if (!id || !secret || !token) throw new Error("Gmail is not set up: run `npm run gmail:auth` (docs/SETUP-ISLAM.md B2).");
    const auth = new google.auth.OAuth2(id, secret);
    auth.setCredentials({ refresh_token: token });
    this.api = google.gmail({ version: "v1", auth });
  }

  async me(): Promise<string> {
    if (!this.address) this.address = (await this.api.users.getProfile({ userId: "me" }).catch(explain)).data.emailAddress ?? "";
    return this.address;
  }

  async send(mail: OutgoingMail) {
    const raw = Buffer.from(buildMime(mail, await this.me())).toString("base64url");
    const res = await this.api.users.messages.send({ userId: "me", requestBody: { raw, threadId: mail.threadId } }).catch(explain);
    const id = res.data.id ?? "";
    // The Message-ID header is needed to thread a follow-up as a real reply.
    const sent = await this.api.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["Message-ID"] });
    return { id, threadId: res.data.threadId ?? "", messageId: toMessage(sent.data).messageId };
  }

  async thread(threadId: string): Promise<MailMessage[]> {
    const res = await this.api.users.threads.get({ userId: "me", id: threadId, format: "full" }).catch(explain);
    return (res.data.messages ?? []).map(toMessage);
  }

  async search(query: string, max = 20): Promise<MailMessage[]> {
    const list = await this.api.users.messages.list({ userId: "me", q: query, maxResults: max }).catch(explain);
    const out: MailMessage[] = [];
    for (const m of list.data.messages ?? []) {
      out.push(toMessage((await this.api.users.messages.get({ userId: "me", id: m.id!, format: "full" })).data));
    }
    return out;
  }
}

/** The PDF CV inside a draft folder (out/drafts/<company>/). */
export function cvAttachment(folder: string): Attachment {
  return { filename: "Islam-Abu-Khadija-CV.pdf", path: path.join(folder, "Islam-Abu-Khadija-CV.pdf"), mimeType: "application/pdf" };
}

/**
 * Gmail over SMTP (send) and IMAP (read) with a Google App Password. No OAuth, so no consent
 * screen, no app publishing, and the credential never expires — which lets the whole pipeline run
 * in the cloud with the Mac off. Needs GMAIL_ADDRESS and GMAIL_APP_PASSWORD in the environment.
 * Replies are found by searching Gmail (company + recency), the same way form applications are.
 */
export class GmailSmtp implements Mailbox {
  private address: string;
  private pass: string;

  constructor(address = process.env.GMAIL_ADDRESS, pass = process.env.GMAIL_APP_PASSWORD) {
    if (!address || !pass) throw new Error("Gmail is not set up: run `npm run gmail:connect` (needs a Google App Password, docs/SETUP-ISLAM.md B2).");
    this.address = address.trim();
    this.pass = pass.replace(/\s+/g, "");
  }

  async me(): Promise<string> {
    return this.address;
  }

  async send(mail: OutgoingMail): Promise<{ id: string; threadId: string; messageId: string }> {
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true, auth: { user: this.address, pass: this.pass },
    });
    try {
      const info = await transport.sendMail({
        from: `"Islam Ibrahim Abu-Khadija" <${this.address}>`,
        to: mail.to, subject: mail.subject, text: mail.body,
        inReplyTo: mail.inReplyTo, references: mail.inReplyTo ? [mail.inReplyTo] : undefined,
        attachments: (mail.attachments ?? []).map((a) => ({ filename: a.filename, path: a.path, contentType: a.mimeType })),
      });
      // No Gmail thread id over SMTP; the Message-ID threads follow-ups, replies are found by search.
      return { id: info.messageId ?? "", threadId: "", messageId: info.messageId ?? "" };
    } finally {
      transport.close();
    }
  }

  /** Not used with the search-based reply flow; kept for the Mailbox interface. */
  async thread(): Promise<MailMessage[]> {
    return [];
  }

  async search(query: string, max = 20): Promise<MailMessage[]> {
    const { ImapFlow } = await import("imapflow");
    const { simpleParser } = await import("mailparser");
    const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: this.address, pass: this.pass }, logger: false });
    const out: MailMessage[] = [];
    await client.connect();
    try {
      // "All Mail" so a reply filed under any label is still found; X-GM-RAW = Gmail search syntax.
      const lock = await client.getMailboxLock("[Gmail]/All Mail");
      try {
        // `gmailRaw` = Gmail's X-GM-RAW search; not in imapflow's typings, so the query is cast.
        const uids = (await client.search({ gmailRaw: query } as Record<string, unknown>, { uid: true })) || [];
        for await (const msg of client.fetch(uids.slice(-max) as number[], { uid: true, source: true }, { uid: true })) {
          const p = await simpleParser(msg.source as Buffer);
          out.push({
            id: String(msg.uid), threadId: "", from: p.from?.text ?? "",
            subject: p.subject ?? "", date: (p.date ?? new Date(0)).toISOString(),
            messageId: p.messageId ?? "", text: (p.text ?? p.html ?? "").toString().replace(/\s+/g, " ").trim().slice(0, 8000),
          });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return out;
  }
}
