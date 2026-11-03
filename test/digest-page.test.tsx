import { readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NIGHT, copyFixture, request, rowsOf, tempRuns } from './support/nights.js';

let runsDir: string;

beforeEach(() => {
  runsDir = tempRuns('rig-page-');
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

/** The page as a browser sees it: status and raw markup, through the app's own request seam. */
async function get(path: string): Promise<{ status: number; html: string }> {
  const { status, text } = await request(runsDir, path);
  return { status, html: text };
}

describe('GET /digest/:night', () => {
  it('renders one row per job, sorted by job', async () => {
    copyFixture(runsDir);

    const { status, html } = await get(`/digest/${NIGHT}`);

    expect(status).toBe(200);
    expect(html).toContain('digest 2026-10-28');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<header>');
    expect(rowsOf(html).map((row) => row.cells[0])).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('shows a missing owner as an em dash instead of an empty cell', async () => {
    copyFixture(runsDir);

    const { html } = await get(`/digest/${NIGHT}`);

    const row = rowsOf(html).find((row) => row.cells[0] === 'digest/render');
    expect(row?.cells[1]).toBe('—');
    expect(rowsOf(html).find((row) => row.cells[0] === 'lane/sync')?.cells[1]).toBe('rook');
  });

  it('shows an empty-string owner and error as an em dash, not an empty cell', async () => {
    writeFileSync(
      join(runsDir, `${NIGHT}.jsonl`),
      JSON.stringify({ at: '2026-10-28T23:00:02+01:00', job: 'lane/sync', status: 'fail', owner: '', error: '' }) + '\n',
    );

    const { html } = await get(`/digest/${NIGHT}`);

    const row = rowsOf(html).find((row) => row.cells[0] === 'lane/sync');
    expect([row?.cells[1], row?.cells[5]]).toEqual(['—', '—']);
  });

  it('labels every digest cell so a narrow screen can stack the table without losing a field', async () => {
    copyFixture(runsDir);

    const { html } = await get(`/digest/${NIGHT}`);
    const headers = [...html.matchAll(/<th>([^<]+)<\/th>/g)].map((match) => match[1]);
    const labels = [...html.matchAll(/<td data-label="([^"]*)"/g)].map((match) => match[1]);

    // Eight columns, five rows: every cell carries its column's name, in column order.
    expect(headers).toEqual(['job', 'owner', 'runs', 'retries', 'last status', 'last error', 'first', 'last']);
    expect(labels).toEqual([...headers, ...headers, ...headers, ...headers, ...headers]);
  });

  it('contains the table on a narrow screen instead of letting it run off the page', async () => {
    copyFixture(runsDir);

    const { html } = await get(`/digest/${NIGHT}`);

    // The page's only table opts into the stacked layout, and the layout supplies the rule.
    expect(html).toContain('<table class="digest">');
    expect(html).toContain('@media (max-width: 40rem)');
    expect(html).toContain('content: attr(data-label)');
    expect(html).toContain('overflow-x: auto');
  });

  it('marks a row with three or more retries while keeping the count readable', async () => {
    copyFixture(runsDir);

    const { html } = await get(`/digest/${NIGHT}`);

    const retried = rowsOf(html).find((row) => row.cells[0] === 'fixtures/refresh');
    expect(retried?.cells[3]).toBe('3');
    expect(retried?.markup).toContain('class="warn"');
    expect(rowsOf(html).find((row) => row.cells[0] === 'lane/sync')?.markup).not.toContain('class="warn"');
  });

  it('marks a row from three retries on, and not at one or two', async () => {
    const retryLine = (minute: number) =>
      JSON.stringify({
        at: `2026-10-29T01:${String(minute).padStart(2, '0')}:00+01:00`,
        job: 'fixtures/refresh',
        status: 'retry',
        owner: 'rook',
        error: 'upstream 503',
      }) + '\n';
    const okLine = JSON.stringify({ at: '2026-10-29T01:37:00+01:00', job: 'fixtures/refresh', status: 'ok', owner: 'rook' }) + '\n';

    const marks: (string | boolean)[][] = [];
    for (const retries of [1, 2, 3, 4]) {
      writeFileSync(
        join(runsDir, `${NIGHT}.jsonl`),
        Array.from({ length: retries }, (_, index) => retryLine(index)).join('') + okLine,
      );

      const row = rowsOf((await get(`/digest/${NIGHT}`)).html).find((candidate) => candidate.cells[0] === 'fixtures/refresh');
      marks.push([String(retries), row?.cells[3] ?? 'no row', row?.markup.includes('class="warn"') ?? false]);
    }

    expect(marks).toEqual([
      ['1', '1', false],
      ['2', '2', false],
      ['3', '3', true],
      ['4', '4', true],
    ]);
  });

  it('marks a failing job and shows its run count, status, error and times', async () => {
    copyFixture(runsDir);

    const { html } = await get(`/digest/${NIGHT}`);

    const failed = rowsOf(html).find((row) => row.cells[0] === 'notes/backup');
    expect(failed?.cells).toEqual([
      'notes/backup',
      'lane-07',
      '1',
      '0',
      'fail',
      'quota exceeded',
      '2026-10-29T04:00:01+01:00',
      '2026-10-29T04:00:01+01:00',
    ]);
    expect(failed?.markup).toContain('class="warn"');
  });

  it('says nothing ran for a night with no events', async () => {
    writeFileSync(join(runsDir, `${NIGHT}.jsonl`), '');

    const { status, html } = await get(`/digest/${NIGHT}`);

    expect(status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(rowsOf(html)).toEqual([]);
  });

  it('counts unreadable lines in a muted note without dropping the night', async () => {
    copyFixture(runsDir);

    const fixturePage = await get(`/digest/${NIGHT}`);
    expect(fixturePage.html).toContain('<p class="mute">1 line unreadable</p>');

    writeFileSync(join(runsDir, '2026-10-27.jsonl'), '{}\nnot json\n');
    const twoBad = await get('/digest/2026-10-27');
    expect(twoBad.html).toContain('<p class="mute">2 lines unreadable</p>');
  });

  it('answers 404 for a night that is not there or a name that is not a night', async () => {
    const missing = await get(`/digest/${NIGHT}`);
    expect(missing.status).toBe(404);
    expect(missing.html).not.toContain(runsDir);

    for (const name of ['../2026-10-28', '..%2F2026-10-28', '2026-10-28.jsonl', '2026-1-28', 'not-a-night']) {
      const res = await get(`/digest/${name}`);
      expect([name, res.status]).toEqual([name, 404]);
    }
    expect(readdirSync(runsDir)).toEqual([]);
  });

  it('answers 500, not 404, when the night file itself cannot be read', async () => {
    writeFileSync(join(runsDir, 'elsewhere.jsonl'), '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok"}\n');
    symlinkSync(join(runsDir, 'elsewhere.jsonl'), join(runsDir, `${NIGHT}.jsonl`));

    const { status, html } = await get(`/digest/${NIGHT}`);

    expect(status).toBe(500);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('could not be read');
    expect(html).not.toContain(runsDir);
    expect(html).not.toContain('ELOOP');
  });

  it('keeps each timestamp exactly as the log wrote it, offset included', async () => {
    writeFileSync(
      join(runsDir, `${NIGHT}.jsonl`),
      [
        '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok"}',
        '{"at":"2026-10-29T05:00:04-04:00","job":"lane/sync","status":"ok"}',
      ].join('\n') + '\n',
    );

    const { html } = await get(`/digest/${NIGHT}`);

    const row = rowsOf(html).find((row) => row.cells[0] === 'lane/sync');
    expect(row?.cells[6]).toBe('2026-10-28T23:00:02+01:00');
    expect(row?.cells[7]).toBe('2026-10-29T05:00:04-04:00');
  });

  it('escapes job, owner and error text from the log', async () => {
    writeFileSync(
      join(runsDir, `${NIGHT}.jsonl`),
      JSON.stringify({
        at: '2026-10-28T23:00:02+01:00',
        job: '<script>alert(1)</script>',
        status: 'fail',
        owner: 'rook & "co"',
        error: 'boom <img src=x onerror=alert(1)>',
      }) + '\n',
    );

    const { html } = await get(`/digest/${NIGHT}`);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('rook &amp; &quot;co&quot;');
    expect(html).toContain('boom &lt;img src=x onerror=alert(1)&gt;');
  });
});
