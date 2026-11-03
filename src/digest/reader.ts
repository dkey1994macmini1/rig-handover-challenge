// Reads one night's run log (2026-10-29-morning-digest, § 1). Section 2 — page, JSON and board — reads nights only
// through here, so the filename policy, the file type policy and the event semantics live in one
// place.

import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, EventCounts, NightDigest, NightRead } from './types.js';

// The night-name rule, written once: the night a route may ask for and the file the board may list
// both derive from it, so the 404 policy and the listing cannot drift apart.
const NIGHT_PATTERN = '\\d{4}-\\d{2}-\\d{2}';
const NIGHT = new RegExp(`^${NIGHT_PATTERN}$`);
const NIGHT_FILE = new RegExp(`^${NIGHT_PATTERN}\\.jsonl$`);
const NIGHT_SUFFIX = '.jsonl';
const STATUSES: readonly DigestStatus[] = ['ok', 'retry', 'fail'];

// The digest routes are unauthenticated and read a whole run log synchronously, so one oversized
// file must not be able to stall the lane's resident service. 4 MiB is far past a real night and
// well under anything that would hurt; a bigger file is a fault, not a digest.
const MAX_NIGHT_BYTES = 4 * 1024 * 1024;

type Event = { at: string; job: string; status: DigestStatus; owner?: string | null; error?: string };

export function readNight(runsDir: string, night: string): NightRead {
  if (!NIGHT.test(night)) return { ok: false, reason: 'invalid' };
  try {
    // Never follow a symlink out of runsDir, never block on a FIFO with no writer, and judge the
    // type of the descriptor we actually opened rather than a second lookup of the path.
    const file = join(runsDir, `${night}${NIGHT_SUFFIX}`);
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) return { ok: false, reason: 'unreadable' };
      // A night file is written where it is read. A second link means this inode is reachable
      // outside runs/, which is exactly what the configured directory is supposed to bound.
      if (stat.nlink > 1) return { ok: false, reason: 'unreadable' };
      if (stat.size > MAX_NIGHT_BYTES) return { ok: false, reason: 'unreadable' };
      // Read at most one byte past what the file promised: the file can grow between the fstat and
      // the read, and a bounded read is the only way that stays a bound on time and memory.
      const limit = Math.min(stat.size, MAX_NIGHT_BYTES) + 1;
      const bytes = Buffer.allocUnsafe(limit);
      let read = 0;
      let grew = false;
      for (;;) {
        const chunk = readSync(fd, bytes, read, limit - read, null);
        if (chunk === 0) break;
        read += chunk;
        if (read < limit) continue;
        const probe = Buffer.allocUnsafe(1);
        grew = readSync(fd, probe, 0, 1, null) > 0;
        break;
      }
      if (grew || read > MAX_NIGHT_BYTES) return { ok: false, reason: 'unreadable' };
      return { ok: true, digest: digestNight(night, bytes.toString('utf8', 0, read)) };
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
 * directory entry is a regular file. The board links exactly these (issue 4). A runs directory that
 * cannot be listed is not an empty night list, and the board must say so.
 */
export function listNights(runsDir: string): { ok: true; nights: string[] } | { ok: false } {
  let names: string[];
  try {
    names = readdirSync(runsDir);
  } catch {
    return { ok: false };
  }
  const nights = names
    .filter((name) => NIGHT_FILE.test(name))
    .map((name) => name.slice(0, -NIGHT_SUFFIX.length))
    .filter((night) => isNightFile(join(runsDir, `${night}${NIGHT_SUFFIX}`)))
    .sort()
    .reverse();
  return { ok: true, nights };
}

/** lstat, so a symlink or a hardlinked file is never listed as a night. */
function isNightFile(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && stat.nlink === 1;
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
      const fresh: DigestRow = {
        job: event.job,
        runs: 1,
        retries: event.status === 'retry' ? 1 : 0,
        status: event.status,
        firstAt: event.at,
        lastAt: event.at,
      };
      carryOptionalFields(fresh, event);
      byJob.set(event.job, fresh);
    } else {
      // Source-line order: the last valid event wins, and a field it never carried is absent again.
      carryOptionalFields(row, event);
      row.status = event.status;
      row.lastAt = event.at;
      row.runs++;
      if (event.status === 'retry') row.retries++;
    }
  }

  const rows = [...byJob.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { night, rows, badLines, counts };
}

/** The log's shape, kept: an absent field stays absent, an explicit null stays null. */
function carryOptionalFields(row: DigestRow, event: Event): void {
  if (event.owner === undefined) delete row.owner;
  else row.owner = event.owner;
  if (event.error === undefined) delete row.error;
  else row.error = event.error;
}

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
  // The spec makes error an optional *string*: a present null is off-shape, unlike owner.
  if (error !== undefined && typeof error !== 'string') return null;

  return {
    at,
    job,
    status: status as DigestStatus,
    ...(owner === undefined ? {} : { owner: typeof owner === 'string' ? owner : null }),
    ...(error === undefined ? {} : { error }),
  };
}
