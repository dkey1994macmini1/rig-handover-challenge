// Reads one night's run log (plan.md § 1). Section 2 — page, JSON and board — reads nights only
// through here, so the filename policy, the file type policy and the event semantics live in one
// place.

import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, EventCounts, NightDigest, NightRead } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const NIGHT_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
const STATUSES: readonly DigestStatus[] = ['ok', 'retry', 'fail'];

type Event = { at: string; job: string; status: DigestStatus; owner: string | null; error: string | null };

export function readNight(runsDir: string, night: string): NightRead {
  if (!NIGHT.test(night)) return { ok: false, reason: 'invalid' };
  try {
    // Never follow a symlink out of runsDir, never block on a FIFO with no writer, and judge the
    // type of the descriptor we actually opened rather than a second lookup of the path.
    const fd = openSync(join(runsDir, `${night}.jsonl`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!fstatSync(fd).isFile()) return { ok: false, reason: 'unreadable' };
      return { ok: true, digest: digestNight(night, readFileSync(fd, 'utf8')) };
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    // Only a night that is not there is 404; permissions, symlinks and special files are faults.
    return { ok: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
}

/**
 * Nights on disk, newest first, under the same file policy as readNight: matching names whose
 * directory entry is a regular file. The board links exactly these (issue 4).
 */
export function listNights(runsDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(runsDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => NIGHT_FILE.test(name))
    .map((name) => name.slice(0, 10))
    .filter((night) => isRegularFile(join(runsDir, `${night}.jsonl`)))
    .sort()
    .reverse();
}

/** lstat, so a symlink to a night file is never listed as a night. */
function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function digestNight(night: string, text: string): NightDigest {
  const lines = text.split('\n');
  // The final newline ends the last line rather than starting an empty one.
  if (lines[lines.length - 1] === '') lines.pop();

  const counts: EventCounts = { ok: 0, retry: 0, fail: 0 };
  const byJob = new Map<string, DigestRow>();
  let badLines = 0;

  for (const line of lines) {
    const event = parseEvent(line);
    if (event === null) {
      badLines++;
      continue;
    }

    counts[event.status]++;
    const row = byJob.get(event.job);
    if (row === undefined) {
      byJob.set(event.job, {
        job: event.job,
        owner: event.owner,
        runs: 1,
        retries: event.status === 'retry' ? 1 : 0,
        status: event.status,
        error: event.error,
        firstAt: event.at,
        lastAt: event.at,
      });
    } else {
      // Source-line order: the last valid event wins, including its absent fields.
      row.owner = event.owner;
      row.status = event.status;
      row.error = event.error;
      row.lastAt = event.at;
      row.runs++;
      if (event.status === 'retry') row.retries++;
    }
  }

  const rows = [...byJob.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { night, rows, badLines, counts };
}

/** One JSON object per line; anything else — unparsable or off-shape — is not an event. */
function parseEvent(line: string): Event | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const { at, job, status, owner, error } = value as Record<string, unknown>;
  if (typeof at !== 'string' || typeof job !== 'string') return null;
  if (!STATUSES.includes(status as DigestStatus)) return null;
  if (owner !== undefined && owner !== null && typeof owner !== 'string') return null;
  if (error !== undefined && error !== null && typeof error !== 'string') return null;

  return {
    at,
    job,
    status: status as DigestStatus,
    owner: typeof owner === 'string' ? owner : null,
    error: typeof error === 'string' ? error : null,
  };
}
