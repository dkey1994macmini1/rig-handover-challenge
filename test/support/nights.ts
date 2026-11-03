// Shared scaffolding for the route-level digest tests (issues 2, 3 and 5): a temp directory that
// stands in for runs/, the read-only fixture copied into it, the app's own request seam, and the
// table parsing that lets a test name the page's cells the way the JSON names its fields.

import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';

/** The real night on disk; runs/ is read-only, so every test copies it into a temp directory. */
export const NIGHT = '2026-10-28';
const FIXTURE = join('runs', `${NIGHT}.jsonl`);

const CONFIG = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60 };

/** A temp directory to be used as a runs directory, named after the test file that owns it. */
export function tempRuns(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeNight(runsDir: string, body: string, night = NIGHT): void {
  writeFileSync(join(runsDir, `${night}.jsonl`), body);
}

export function copyFixture(runsDir: string, night = NIGHT): void {
  copyFileSync(FIXTURE, join(runsDir, `${night}.jsonl`));
}

/** Any path, through the app's own request seam, against one temp runs directory. */
export async function request(runsDir: string, path: string): Promise<{ status: number; text: string }> {
  const res = await createApp({ ...CONFIG, runsDir }).request(path);
  return { status: res.status, text: await res.text() };
}

/** One row as the JSON carries it: the page's eight columns under the same names. */
export type ApiRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  status: string;
  error: string | null;
  firstAt: string;
  lastAt: string;
};

export type ApiNight = { night: string; rows: ApiRow[]; badLines: number };

/** The JSON answer to a night, parsed. Only for a response the API gave a body. */
export function parseNight(text: string): ApiNight {
  return JSON.parse(text) as ApiNight;
}

/** Each table body row with its raw markup and its cell text, in document order. */
export function rowsOf(html: string): { markup: string; cells: string[] }[] {
  const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) => ({
    markup: row[0],
    cells: [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]),
  }));
}

/** The page's eight columns for one JSON row: what the log never carried is the em dash. */
export function cellsOf(row: ApiRow): string[] {
  return [row.job, row.owner ?? '—', String(row.runs), String(row.retries), row.status, row.error ?? '—', row.firstAt, row.lastAt];
}
