// One-time Gmail setup with a Google App Password (docs/SETUP-ISLAM.md B2). Run: `npm run gmail:connect`.
// Reads the 16-character app password from the terminal (never echoed to chat), verifies it with a
// real SMTP + IMAP login, and writes GMAIL_ADDRESS / GMAIL_APP_PASSWORD to .env. The password is
// never printed. App passwords do not expire, so this is done once.
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setEnv } from "./gmailAuth.js";

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const address = (process.env.GMAIL_ADDRESS || (await rl.question("Your Gmail address: "))).trim();
  const raw = await rl.question("Paste the 16-character app password (it won't be shown again): ");
  rl.close();
  const pass = raw.replace(/\s+/g, "");
  if (!/^[a-z]{16}$/i.test(pass)) {
    throw new Error(`That doesn't look like an app password (expected 16 letters, got ${pass.length} characters). Create one at myaccount.google.com/apppasswords`);
  }

  // Verify SMTP (send) and IMAP (read) before saving, so a wrong password is caught now.
  const nodemailer = (await import("nodemailer")).default;
  const smtp = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: address, pass } });
  await smtp.verify();
  smtp.close();
  const { ImapFlow } = await import("imapflow");
  const imap = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: address, pass }, logger: false });
  await imap.connect();
  await imap.logout();

  const envFile = path.join(process.cwd(), ".env");
  let env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  env = setEnv(env, "GMAIL_ADDRESS", address);
  env = setEnv(env, "GMAIL_APP_PASSWORD", pass);
  // The old OAuth values are no longer used.
  env = env.replace(/^GMAIL_(CLIENT_ID|CLIENT_SECRET|REFRESH_TOKEN|AUTH_AT)=.*$\n?/gm, "");
  writeFileSync(envFile, env);
  console.log(`Gmail connected over SMTP + IMAP as ${address}. Saved to .env (password not printed). This does not expire.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
