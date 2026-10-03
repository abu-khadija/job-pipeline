// Is the job still open? A closed listing wastes a draft (Phase 2) and an application.
// Only 404/410 count as "gone": many sites block HEAD or bots, and those must not hide a job.

export type Liveness = "live" | "gone" | "unknown";

export type Fetcher = (url: string, init: RequestInit) => Promise<{ status: number }>;

export async function checkLive(url: string, userAgent: string, doFetch: Fetcher = fetch): Promise<Liveness> {
  const init = (method: string): RequestInit => ({
    method,
    redirect: "follow",
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(15_000),
  });
  try {
    let res = await doFetch(url, init("HEAD"));
    // Some servers don't support HEAD; ask again with GET.
    if (res.status === 405 || res.status === 403 || res.status === 501) res = await doFetch(url, init("GET"));
    if (res.status === 404 || res.status === 410) return "gone";
    return res.status < 400 ? "live" : "unknown";
  } catch {
    return "unknown";
  }
}
