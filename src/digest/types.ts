// The digest contract (plan.md § 1). Section 2 — page, JSON and board — builds on these types
// alone, so the reader's shape is agreed before a single route exists.

export type DigestStatus = 'ok' | 'retry' | 'fail';

/** One job's night. A field the log never carried stays null; the view renders the em dash. */
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  status: DigestStatus;
  error: string | null;
  /** Source line order, timestamp string kept as written (offset never converted). */
  firstAt: string;
  lastAt: string;
};

/**
 * Valid events by status. Counted over events, not final rows: a job that retried and then
 * succeeded counts one retry and one ok (D4), which the rows alone cannot reconstruct.
 */
export type EventCounts = { ok: number; retry: number; fail: number };

export type NightDigest = {
  night: string;
  /** One row per job, sorted lexically by job. */
  rows: DigestRow[];
  /** Lines that did not parse or did not match the event shape; they never abort the night. */
  badLines: number;
  counts: EventCounts;
};

/**
 * Why a night could not be read. `missing` and `invalid` answer 404; `unreadable` is a real
 * fault (permissions, a special file) and must not masquerade as a night that is not there.
 */
export type NightFailure = 'missing' | 'invalid' | 'unreadable';

export type NightRead = { ok: true; digest: NightDigest } | { ok: false; reason: NightFailure };

/**
 * The reader's signature: readNight(runsDir, night). Validates the night name, opens the file
 * without following symlinks, and never reads outside `runsDir`. Section 2 codes against this.
 */
export type ReadNight = (runsDir: string, night: string) => NightRead;
