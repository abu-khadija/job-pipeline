// One-time Gmail sign-in (docs/SETUP-ISLAM.md B2). Run on the Mac: `npm run gmail:auth`.
// Reads the OAuth "Desktop app" client JSON, opens Google's consent page, catches the reply on a
// local port, and writes GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN into .env.
// The token is never printed.
import "dotenv/config";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { google } from "googleapis";
import { GMAIL_SCOPES } from "./gmail.js";

const CLIENT_FILE = process.env.GMAIL_OAUTH_CLIENT_JSON_PATH ?? path.join(homedir(), ".secrets", "gmail-oauth-client.json");

/** Sets KEY=value in .env, replacing an existing line. */
export function setEnv(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, "\n")}${line}\n`;
}

async function main() {
  if (!existsSync(CLIENT_FILE)) {
    throw new Error(`OAuth client file not found at ${CLIENT_FILE}. Download it in Google Cloud (Desktop app client) and save it there.`);
  }
  const json = JSON.parse(readFileSync(CLIENT_FILE, "utf8"));
  const c = json.installed ?? json.web;
  if (!c?.client_id || !c?.client_secret) throw new Error("That file is not an OAuth client JSON (expected an \"installed\" Desktop app client).");

  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const redirect = `http://127.0.0.1:${port}`;
  const auth = new google.auth.OAuth2(c.client_id, c.client_secret, redirect);
  // prompt=consent makes Google return a refresh token even if you signed in before.
  const url = auth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: GMAIL_SCOPES });

  console.log("Opening Google sign-in in your browser. Sign in with islamabukhadiga@gmail.com and allow access.");
  console.log(`If it doesn't open, paste this into your browser:\n${url}\n`);
  execFile("open", [url], () => undefined);

  const code = await new Promise<string>((resolve, reject) => {
    server.on("request", (req, res) => {
      const u = new URL(req.url ?? "/", redirect);
      const code = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(code ? "<h2>Done. You can close this tab and go back to the terminal.</h2>" : `<h2>Sign-in failed: ${err ?? "no code"}</h2>`);
      if (code) resolve(code);
      else if (err) reject(new Error(`Google sign-in failed: ${err}`));
    });
  });
  server.close();

  const { tokens } = await auth.getToken(code);
  if (!tokens.refresh_token) throw new Error("Google returned no refresh token. Remove the app's access at myaccount.google.com/permissions and run again.");

  const envFile = path.join(process.cwd(), ".env");
  let env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  env = setEnv(env, "GMAIL_CLIENT_ID", c.client_id);
  env = setEnv(env, "GMAIL_CLIENT_SECRET", c.client_secret);
  env = setEnv(env, "GMAIL_REFRESH_TOKEN", tokens.refresh_token);
  writeFileSync(envFile, env);

  auth.setCredentials(tokens);
  const profile = await google.gmail({ version: "v1", auth }).users.getProfile({ userId: "me" });
  console.log(`Gmail connected: ${profile.data.emailAddress}. Saved to .env (not printed).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
