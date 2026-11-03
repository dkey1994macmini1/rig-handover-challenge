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
  /** False when runs/ could not be listed at all: the board says that, not "nothing in runs/". */
  nightsReadable: boolean;
};

export function readStatus(config: RigConfig): Status {
  const listed = listNights(config.runsDir);
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nightsReadable: listed.ok,
    // A night whose bytes cannot be read keeps its link and shows the em dash for every count.
    nights: listed.ok
      ? listed.nights.map((night) => {
          const read = readNight(config.runsDir, night);
          return { night, counts: read.ok ? read.digest.counts : null };
        })
      : [],
  };
}
