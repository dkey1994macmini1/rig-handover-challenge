import type { RigConfig } from './config.js';
import { listNights, readNight } from './digest/reader.js';
import type { EventCounts } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

/** One linked night: its valid-event counts, or null when the file could not be read. */
export type NightSummary = { night: string; counts: EventCounts | null };

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightSummary[];
};

export function readStatus(config: RigConfig): Status {
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    // Same file policy as the digest routes: the board links exactly the nights the reader lists.
    nights: listNights(config.runsDir).map((night) => {
      const read = readNight(config.runsDir, night);
      return { night, counts: read.ok ? read.digest.counts : null };
    }),
  };
}
