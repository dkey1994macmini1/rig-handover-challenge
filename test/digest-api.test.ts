import { readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NIGHT, cellsOf, copyFixture, parseNight, request, rowsOf, tempRuns, writeNight } from './support/nights.js';

let runsDir: string;

beforeEach(() => {
  runsDir = tempRuns('rig-json-');
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

/** The API through the app's own request seam — the same app the page is served by. */
const raw = (path: string) => request(runsDir, path);

/** A night the API answers in full: status, the raw body and the parsed object. */
async function get(path: string) {
  const { status, text } = await raw(path);
  return { status, body: parseNight(text), text };
}

describe('GET /api/digest/:night', () => {
  it('answers the night as JSON: one row per job, sorted by job, bad lines counted', async () => {
    copyFixture(runsDir);

    const { status, body } = await get(`/api/digest/${NIGHT}`);

    expect(status).toBe(200);
    // The key set, sorted on both sides: what the body carries, not the order JSON happened to use.
    expect(Object.keys(body).sort()).toEqual(['badLines', 'night', 'rows']);
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

  it('carries every row field the page renders, an explicit null kept and offsets verbatim', async () => {
    copyFixture(runsDir);

    const { body, text } = await get(`/api/digest/${NIGHT}`);

    expect(body.rows).toEqual([
      {
        job: 'digest/render',
        owner: null,
        runs: 1,
        retries: 0,
        status: 'ok',
        firstAt: '2026-10-29T05:41:09+01:00',
        lastAt: '2026-10-29T05:41:09+01:00',
      },
      {
        job: 'fixtures/refresh',
        owner: 'rook',
        runs: 4,
        retries: 3,
        status: 'ok',
        firstAt: '2026-10-29T01:30:00+01:00',
        lastAt: '2026-10-29T01:37:00+01:00',
      },
      {
        job: 'lane/sync',
        owner: 'rook',
        runs: 8,
        retries: 1,
        status: 'ok',
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
        firstAt: '2026-10-28T23:00:02+01:00',
        lastAt: '2026-10-28T23:00:02+01:00',
      },
    ]);
    // An explicit null stays null; a field the log never carried is absent from the body.
    expect(text).toContain('"owner":null');
    expect(text).not.toContain('"error":null');
    expect('error' in body.rows[0]).toBe(false);
  });

  it('counts malformed and off-shape lines and leaves them out of the rows', async () => {
    writeNight(
      runsDir,
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
        firstAt: '2026-10-28T23:00:02+01:00',
        lastAt: '2026-10-28T23:00:02+01:00',
      },
      {
        job: 'notes/backup',
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
    writeNight(
      runsDir,
      [
        '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok"}',
        '{"at":"2026-10-29T05:00:04-04:00","job":"lane/sync","status":"ok"}',
      ].join('\n') + '\n',
    );

    const { body } = await get(`/api/digest/${NIGHT}`);

    expect(body.rows).toEqual([
      {
        job: 'lane/sync',
        runs: 2,
        retries: 0,
        status: 'ok',
        firstAt: '2026-10-28T23:00:02+01:00',
        lastAt: '2026-10-29T05:00:04-04:00',
      },
    ]);
  });

  it('answers an empty night with 200 and no rows', async () => {
    writeNight(runsDir, '');

    const { status, body } = await get(`/api/digest/${NIGHT}`);

    expect(status).toBe(200);
    expect(body).toEqual({ night: NIGHT, rows: [], badLines: 0 });
  });

  it('answers 404 for a night that is not there', async () => {
    const { status } = await raw(`/api/digest/${NIGHT}`);

    expect(status).toBe(404);
  });

  it('answers 404 for a name that is not a night and writes nothing', async () => {
    copyFixture(runsDir);

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
    copyFixture(runsDir);

    const api = await get(`/api/digest/${NIGHT}`);
    const page = await raw(`/digest/${NIGHT}`);

    expect(api.status).toBe(200);
    expect(page.status).toBe(200);
    expect(rowsOf(page.text).map((row) => row.cells[0])).toEqual(api.body.rows.map((row) => row.job));
    expect(rowsOf(page.text).map((row) => row.cells)).toEqual(api.body.rows.map(cellsOf));
    expect(page.text).toContain(`<p class="mute">${api.body.badLines} line unreadable</p>`);
  });
});
