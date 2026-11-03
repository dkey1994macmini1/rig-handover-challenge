// The cross-route seam for the digest (plan.md § 2b, issue 5). The reader, the page and the JSON
// each have focused tests of their own; this file asks the question only the pair of routes can
// answer: does one night get one answer on both endpoints, and do the input-to-file and
// input-to-HTML boundaries hold when a request reaches them?

import { copyFileSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';

/** The real night, copied into a temp directory: runs/ is read-only and never written. */
const FIXTURE = join('runs', '2026-10-28.jsonl');
const NIGHT = '2026-10-28';

const config: RigConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: 'runs',
};

/** A row as the JSON carries it: the page's eight columns under the same names. */
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
  runsDir = mkdtempSync(join(tmpdir(), 'rig-routes-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

function writeNight(body: string, night = NIGHT): void {
  writeFileSync(join(runsDir, `${night}.jsonl`), body);
}

function copyFixture(night = NIGHT): void {
  copyFileSync(FIXTURE, join(runsDir, `${night}.jsonl`));
}

/** Any path, through the app's own seam, against this test's runs directory. */
async function get(path: string): Promise<{ status: number; text: string }> {
  const res = await createApp({ ...config, runsDir }).request(path);
  return { status: res.status, text: await res.text() };
}

/** One row of the page's table: its raw markup, for the warning class, and its cell text. */
type PageRow = { markup: string; cells: string[] };

function pageRows(html: string): PageRow[] {
  const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) => ({
    markup: row[0],
    cells: [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]),
  }));
}

/** The page's eight columns for one JSON row: what the log never carried is the em dash. */
function pageCellsOf(row: ApiRow): string[] {
  return [
    row.job,
    row.owner ?? '—',
    String(row.runs),
    String(row.retries),
    row.status,
    row.error ?? '—',
    row.firstAt,
    row.lastAt,
  ];
}

/** The JSON answer to a night, parsed. Only for a response the API gave a body. */
function parseNight(text: string): ApiNight {
  return JSON.parse(text) as ApiNight;
}

/** The board's list item for one night: its link and its counts, and nothing from its neighbour. */
function boardItem(html: string, night: string): string {
  const item = html.split('<li>').find((chunk) => chunk.includes(`href="/digest/${night}"`));
  if (item === undefined) throw new Error(`the board does not link ${night}`);
  return item.slice(0, item.indexOf('</li>'));
}

/** The one link a board item carries: the page a reader follows (scenario B1). */
function hrefOf(item: string): string {
  const href = item.match(/href="([^"]+)"/);
  if (href === null) throw new Error('this board item carries no link');
  return href[1];
}

describe('one night, both digest routes', () => {
  it('answers a valid night with the same jobs, in the same order, with the same values', async () => {
    copyFixture();

    const page = await get(`/digest/${NIGHT}`);
    const json = await get(`/api/digest/${NIGHT}`);
    const api = parseNight(json.text);

    expect([page.status, json.status]).toEqual([200, 200]);
    expect(api.night).toBe(NIGHT);
    expect(api.rows.map((row) => row.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(pageRows(page.text).map((row) => row.cells[0])).toEqual(api.rows.map((row) => row.job));
    expect(pageRows(page.text).map((row) => row.cells)).toEqual(api.rows.map(pageCellsOf));
  });

  it('answers 404 on both routes for a night that is not there', async () => {
    const page = await get(`/digest/${NIGHT}`);
    const json = await get(`/api/digest/${NIGHT}`);

    expect([page.status, json.status]).toEqual([404, 404]);
    expect(page.text).not.toContain(runsDir);
    expect(json.text).not.toContain(runsDir);
  });

  it.each([
    ['traversal', '../2026-10-28'],
    ['encoded traversal', '..%2F2026-10-28'],
    ['file extension included', '2026-10-28.jsonl'],
    ['unpadded month', '2026-1-28'],
    ['absolute path', '%2Fetc%2Fpasswd'],
    ['empty segment', ''],
  ])('answers 404 on both routes for an invalid night name: %s', async (_label, name) => {
    copyFixture();

    const page = await get(`/digest/${name}`);
    const json = await get(`/api/digest/${name}`);

    expect([page.status, json.status]).toEqual([404, 404]);
    expect(page.text).not.toContain(runsDir);
    expect(json.text).not.toContain('/etc/passwd');
    expect(readdirSync(runsDir)).toEqual([`${NIGHT}.jsonl`]);
  });

  it('answers 500, never 404, on both routes when the night file cannot be read', async () => {
    // A night file that is really a symlink: refused by the reader's file policy. That is a fault
    // in the input-to-file boundary, not a night that is not there.
    writeFileSync(
      join(runsDir, 'elsewhere.jsonl'),
      '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok"}\n',
    );
    symlinkSync(join(runsDir, 'elsewhere.jsonl'), join(runsDir, `${NIGHT}.jsonl`));

    const page = await get(`/digest/${NIGHT}`);
    const json = await get(`/api/digest/${NIGHT}`);

    expect([page.status, json.status]).toEqual([500, 500]);
    for (const body of [page.text, json.text]) {
      expect(body).not.toContain(runsDir);
      expect(body).not.toContain('ELOOP');
      expect(body).not.toMatch(/\n\s+at /);
    }
    // The page says one plain sentence and nothing else; the JSON says nothing at all.
    expect(page.text).toContain('could not be read');
    expect(json.text).toBe('');
  });

  it('answers an empty night as nothing ran with no rows', async () => {
    writeNight('');

    const page = await get(`/digest/${NIGHT}`);
    const json = await get(`/api/digest/${NIGHT}`);

    expect([page.status, json.status]).toEqual([200, 200]);
    expect(page.text).toContain('nothing ran');
    expect(pageRows(page.text)).toEqual([]);
    expect(parseNight(json.text)).toEqual({ night: NIGHT, rows: [], badLines: 0 });
  });

  it('keeps the readable rows of a night with malformed and off-shape lines, counting the rest', async () => {
    writeNight(
      [
        '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
        'not json at all',
        '{"at":"2026-10-28T23:00:03+01:00","job":"lane/sync","status":"done"}',
        '{"at":"2026-10-28T23:00:04+01:00","status":"ok"}',
        '{"at":42,"job":"lane/sync","status":"ok"}',
        '{}',
        'null',
        '["lane/sync","ok"]',
        '{"at":"2026-10-29T04:00:01+01:00","job":"notes/backup","status":"fail","error":"quota exceeded"}',
      ].join('\n') + '\n',
    );

    const page = await get(`/digest/${NIGHT}`);
    const api = parseNight((await get(`/api/digest/${NIGHT}`)).text);
    const rows = pageRows(page.text);

    expect(api.badLines).toBe(7);
    expect(api.rows.map((row) => row.job)).toEqual(['lane/sync', 'notes/backup']);
    expect(rows.map((row) => row.cells)).toEqual(api.rows.map(pageCellsOf));
    expect(page.text).toContain(`<p class="mute">${api.badLines} lines unreadable</p>`);
  });

  it('renders a null owner as an em dash and keeps it null in the JSON', async () => {
    writeNight(
      [
        '{"at":"2026-10-29T05:41:09+01:00","job":"digest/render","status":"ok","owner":null}',
        '{"at":"2026-10-29T04:00:01+01:00","job":"notes/backup","status":"fail","error":"quota exceeded"}',
      ].join('\n') + '\n',
    );

    const json = await get(`/api/digest/${NIGHT}`);
    const api = parseNight(json.text);
    const rows = pageRows((await get(`/digest/${NIGHT}`)).text);

    expect(api.rows.map((row) => row.owner)).toEqual([null, null]);
    expect(api.rows.map((row) => row.error)).toEqual([null, 'quota exceeded']);
    expect(rows.map((row) => [row.cells[0], row.cells[1]])).toEqual([
      ['digest/render', '—'],
      ['notes/backup', '—'],
    ]);
    // Null, not an absent key: a reader of the JSON can tell no owner from no field.
    expect(json.text).toContain('"owner":null');
  });

  it('marks three retries and a last failure on the page with the values the JSON carries', async () => {
    writeNight(
      [
        '{"at":"2026-10-29T01:30:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
        '{"at":"2026-10-29T01:31:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
        '{"at":"2026-10-29T01:33:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
        '{"at":"2026-10-29T01:37:00+01:00","job":"fixtures/refresh","status":"ok","owner":"rook"}',
        '{"at":"2026-10-29T02:00:03+01:00","job":"lane/sync","status":"retry","owner":"rook","error":"lock held"}',
        '{"at":"2026-10-29T02:00:33+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
        '{"at":"2026-10-29T04:00:01+01:00","job":"notes/backup","status":"fail","owner":"lane-07","error":"quota exceeded"}',
      ].join('\n') + '\n',
    );

    const api = parseNight((await get(`/api/digest/${NIGHT}`)).text);
    const rows = pageRows((await get(`/digest/${NIGHT}`)).text);

    expect(api.rows.find((row) => row.job === 'fixtures/refresh')).toMatchObject({ runs: 4, retries: 3, status: 'ok' });
    expect(api.rows.find((row) => row.job === 'notes/backup')).toMatchObject({ retries: 0, status: 'fail' });
    expect(api.rows.find((row) => row.job === 'lane/sync')).toMatchObject({ runs: 2, retries: 1, status: 'ok' });

    const marked = (job: string) => rows.find((row) => row.cells[0] === job)?.markup.includes('class="warn"');
    expect([marked('fixtures/refresh'), marked('notes/backup'), marked('lane/sync')]).toEqual([true, true, false]);
    expect(rows.map((row) => row.cells)).toEqual(api.rows.map(pageCellsOf));
  });

  it('escapes log text in the page markup and keeps the raw string in the JSON', async () => {
    const job = '<script>alert(1)</script>';
    const owner = 'rook & "co"';
    const error = 'boom <img src=x onerror=alert(1)>';
    writeNight(JSON.stringify({ at: '2026-10-28T23:00:02+01:00', job, status: 'fail', owner, error }) + '\n');

    const page = await get(`/digest/${NIGHT}`);
    const api = parseNight((await get(`/api/digest/${NIGHT}`)).text);

    // The JSON is data, not markup: its reader gets exactly what the log said.
    expect(api.rows[0]).toMatchObject({ job, owner, error });

    // The page is markup: no injected tag survives, and the escaped form is what renders.
    expect(page.text).not.toContain(job);
    expect(page.text).not.toContain('<img src=x');
    expect(page.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page.text).toContain('rook &amp; &quot;co&quot;');
    expect(page.text).toContain('boom &lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('board to digest', () => {
  it('links each night with counts that keep a retry that later succeeded, and each link is the API night', async () => {
    writeNight(
      [
        '{"at":"2026-10-29T01:30:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
        '{"at":"2026-10-29T01:31:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
        '{"at":"2026-10-29T01:37:00+01:00","job":"fixtures/refresh","status":"ok","owner":"rook"}',
      ].join('\n') + '\n',
      '2026-10-27',
    );
    writeNight(
      [
        '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
        '{"at":"2026-10-29T04:00:01+01:00","job":"notes/backup","status":"fail","owner":"lane-07","error":"quota exceeded"}',
      ].join('\n') + '\n',
    );

    const board = await get('/');

    expect(board.status).toBe(200);
    // Counts are valid events, so the two retries that ended in ok still count (D4, scenario B1).
    expect(boardItem(board.text, '2026-10-27')).toContain('ok 1 · retry 2 · fail 0');
    expect(boardItem(board.text, '2026-10-28')).toContain('ok 1 · retry 0 · fail 1');

    // Following the link the board printed opens the same night the API answers.
    for (const nightName of ['2026-10-27', '2026-10-28']) {
      const linked = await get(hrefOf(boardItem(board.text, nightName)));
      const api = parseNight((await get(`/api/digest/${nightName}`)).text);

      expect([nightName, linked.status]).toEqual([nightName, 200]);
      expect(pageRows(linked.text).map((row) => row.cells[0])).toEqual(api.rows.map((row) => row.job));
      expect(pageRows(linked.text).map((row) => row.cells)).toEqual(api.rows.map(pageCellsOf));
    }
  });
});
