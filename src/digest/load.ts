// One night, one answer (plan.md § 2). Page and JSON both come through here, so a night that is
// missing, invalid or unreadable maps to the same HTTP status everywhere.

import { readNight } from './reader.js';
import type { NightDigest } from './types.js';

export type LoadedNight = { ok: true; digest: NightDigest } | { ok: false; status: 404 | 500 };

export function loadNightDigest(runsDir: string, night: string): LoadedNight {
  const read = readNight(runsDir, night);
  if (read.ok) return { ok: true, digest: read.digest };
  return { ok: false, status: read.reason === 'unreadable' ? 500 : 404 };
}
