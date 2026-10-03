// A short daily-glance message: the best new jobs from this run plus the heartbeat, so
// Islam doesn't need to open the Sheet. Sent only to Islam's own Telegram chat (optional).
import type { JobRow, RunLog } from "./schema.js";

export function buildDigest(newRows: JobRow[], run: RunLog, max = 5): string {
  const top = newRows
    .filter((r) => r.status === "shortlisted" || r.status === "maybe")
    .sort((a, b) => Number(b.score) - Number(a.score))
    .slice(0, max);
  const lines = [
    `Job pipeline · ${run.started_at.slice(0, 16).replace("T", " ")} UTC · ${run.mode}`,
    `New ${run.new} · scored ${run.scored} · shortlisted total ${run.shortlisted} · watchlist +${run.watchlist_added} · ~$${run.cost_usd_est}`,
  ];
  if (run.errors) lines.push(`Errors: ${run.errors.slice(0, 300)}`);
  lines.push("");
  if (top.length === 0) {
    lines.push("No new shortlisted or maybe jobs this run.");
  } else {
    for (const r of top) {
      lines.push(`${r.score} · ${r.title} — ${r.company} [${r.status}]`);
      if (r.why) lines.push(`   ${r.why}`);
      lines.push(`   ${r.url}`);
    }
  }
  return lines.join("\n");
}

/** Sends the digest with the Telegram Bot API. Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID. */
export async function sendTelegram(text: string, token: string, chatId: string, doFetch: typeof fetch = fetch): Promise<void> {
  const res = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
}
