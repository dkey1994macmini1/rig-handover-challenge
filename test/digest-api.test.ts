import { copyFileSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

/** The real night, copied into a temp directory: runs/ is read-only and never written. */
const FIXTURE = join('runs', '2026-10-28.jsonl');
const NIGHT = '2026-10-28';

/** One row as the JSON body carries it: the page's eight columns, same names, same values. */
type ApiRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  status: string;
  error: string | null;
  firstAt: string;
  lastAt: string;
};

type ApiNight = { night: string; rows: ApiRow[]; badLines: number };

let runsDir: string;

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-json-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

function copyFixture(night = NIGHT): void {
  copyFileSync(FIXTURE, join(runsDir, `${night}.jsonl`));
}

/** The API through the app's own request seam — the same app the page is served by. */
async function raw(path: string): Promise<{ status: number; text: string }> {
  const res = await createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  }).request(path);
  return { status: res.status, text: await res.text() };
}

/** A night the API answers in full: status, the raw body and the parsed object. */
async function get(path: string): Promise<{ status: number; body: ApiNight; text: string }> {
  const { status, text } = await raw(path);
  return { status, body: JSON.parse(text) as ApiNight, text };
}

/** The page's table body as cell text, in document order — the same columns the JSON names. */
function pageCells(html: string): string[][] {
  const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]),
  );
}

/** One API row as the page renders it: a missing value is the em dash, numbers as text. */
function asPageCells(row: ApiRow): string[] {
  return [row.job, row.owner ?? '—', String(row.runs), String(row.retries), row.status, row.error ?? '—', row.firstAt, row.lastAt];
}

describe('GET /api/digest/:night', () => {
  it('answers the night as JSON: one row per job, sorted by job, bad lines counted', async () => {
    copyFixture();

    const { status, body } = await get(`/api/digest/${NIGHT}`);

    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(['night', 'rows', 'badLines']);
    expect(body.night).toBe(NIGHT);
    expect(body.rows.map((row) => row.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(body.badLines).toBe(1);
  });

  it('carries every row field the page renders, nulls kept and timestamp offsets verbatim', async () => {
    copyFixture();

    const { body, text } = await get(`/api/digest/${NIGHT}`);

    expect(body.rows).toEqual([
      {
        job: 'digest/render',
        owner: null,
        runs: 1,
        retries: 0,
        status: 'ok',
        error: null,
        firstAt: '2026-10-29T05:41:09+01:00',
        lastAt: '2026-10-29T05:41:09+01:00',
      },
      {
        job: 'fixtures/refresh',
        owner: 'rook',
        runs: 4,
        retries: 3,
        status: 'ok',
        error: null,
        firstAt: '2026-10-29T01:30:00+01:00',
        lastAt: '2026-10-29T01:37:00+01:00',
      },
      {
        job: 'lane/sync',
        owner: 'rook',
        runs: 8,
        retries: 1,
        status: 'ok',
        error: null,
        firstAt: '2026-10-28T23:00:06+01:00',
        lastAt: '2026-10-29T05:00:04+01:00',
      },
      {
        job: 'notes/backup',
        owner: 'lane-07',
        runs: 1,
        retries: 0,
        status: 'fail',
        error: 'quota exceeded',
        firstAt: '2026-10-29T04:00:01+01:00',
        lastAt: '2026-10-29T04:00:01+01:00',
      },
      {
        job: 'rig/rotate-logs',
        owner: 'lane-07',
        runs: 1,
        retries: 0,
        status: 'ok',
        error: null,
        firstAt: '2026-10-28T23:00:02+01:00',
        lastAt: '2026-10-28T23:00:02+01:00',
      },
    ]);
    // A field the log never carried is null in the body, not dropped from the object.
    expect(text).toContain('"owner":null');
    expect(text).toContain('"error":null');
  });

  it('counts malformed and off-shape lines and leaves them out of the rows', async () => {
    writeFileSync(
      join(runsDir, `${NIGHT}.jsonl`),
      [
        '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
        'not json at all',
        '{"at":"2026-10-28T23:00:03+01:00","job":"lane/sync","status":"done"}',
        '{"at":"2026-10-28T23:00:04+01:00","status":"ok"}',
        '{}',
        'null',
        '{"at":"2026-10-29T04:00:01+01:00","job":"notes/backup","status":"fail","error":"quota exceeded"}',
      ].join('\n') + '\n',
    );

    const { status, body } = await get(`/api/digest/${NIGHT}`);

    expect(status).toBe(200);
    expect(body.badLines).toBe(5);
    expect(body.rows).toEqual([
      {
        job: 'lane/sync',
        owner: 'rook',
        runs: 1,
        retries: 0,
        status: 'ok',
        error: null,
        firstAt: '2026-10-28T23:00:02+01:00',
        lastAt: '2026-10-28T23:00:02+01:00',
      },
      {
        job: 'notes/backup',
        owner: null,
        runs: 1,
        retries: 0,
        status: 'fail',
        error: 'quota exceeded',
        firstAt: '2026-10-29T04:00:01+01:00',
        lastAt: '2026-10-29T04:00:01+01:00',
      },
    ]);
  });

  it('keeps each timestamp exactly as the log wrote it, offset included', async () => {
    writeFileSync(
      join(runsDir, `${NIGHT}.jsonl`),
      [
        '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok"}',
        '{"at":"2026-10-29T05:00:04-04:00","job":"lane/sync","status":"ok"}',
      ].join('\n') + '\n',
    );

    const { body } = await get(`/api/digest/${NIGHT}`);

    expect(body.rows).toEqual([
      {
        job: 'lane/sync',
        owner: null,
        runs: 2,
        retries: 0,
        status: 'ok',
        error: null,
        firstAt: '2026-10-28T23:00:02+01:00',
        lastAt: '2026-10-29T05:00:04-04:00',
      },
    ]);
  });

  it('answers an empty night with 200 and no rows', async () => {
    writeFileSync(join(runsDir, `${NIGHT}.jsonl`), '');

    const { status, body } = await get(`/api/digest/${NIGHT}`);

    expect(status).toBe(200);
    expect(body).toEqual({ night: NIGHT, rows: [], badLines: 0 });
  });

  it('answers 404 for a night that is not there', async () => {
    const { status } = await raw(`/api/digest/${NIGHT}`);

    expect(status).toBe(404);
  });

  it('answers 404 for a name that is not a night and writes nothing', async () => {
    copyFixture();

    // `../2026-10-28` is normalized away before the handler; `..%2F` reaches the night-name
    // policy as `../2026-10-28` and is refused there, so traversal is refused in both layers.
    for (const name of ['../2026-10-28', '..%2F2026-10-28', '2026-10-28.jsonl', '2026-1-28']) {
      const { status, text } = await raw(`/api/digest/${name}`);
      expect([name, status]).toEqual([name, 404]);
      expect(text).not.toContain(runsDir);
    }
    expect(readdirSync(runsDir)).toEqual([`${NIGHT}.jsonl`]);
  });

  it('answers 500, not 404, when the night file itself cannot be read', async () => {
    writeFileSync(join(runsDir, 'elsewhere.jsonl'), '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok"}\n');
    symlinkSync(join(runsDir, 'elsewhere.jsonl'), join(runsDir, `${NIGHT}.jsonl`));

    const { status, text } = await raw(`/api/digest/${NIGHT}`);

    expect(status).toBe(500);
    expect(text).not.toContain(runsDir);
    expect(text).not.toContain('ELOOP');
  });

  it('shows the page and the JSON the same jobs in the same order with the same values', async () => {
    copyFixture();

    const api = await get(`/api/digest/${NIGHT}`);
    const page = await raw(`/digest/${NIGHT}`);

    expect(api.status).toBe(200);
    expect(page.status).toBe(200);
    expect(pageCells(page.text).map((cells) => cells[0])).toEqual(api.body.rows.map((row) => row.job));
    expect(pageCells(page.text)).toEqual(api.body.rows.map(asPageCells));
    expect(page.text).toContain(`<p class="mute">${api.body.badLines} line unreadable</p>`);
  });
});
