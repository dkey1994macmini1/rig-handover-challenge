import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listNights, readNight } from '../src/digest/reader.js';
import type { NightDigest } from '../src/digest/types.js';

let runsDir: string;

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

function writeNight(body: string, night = '2026-10-28'): void {
  writeFileSync(join(runsDir, `${night}.jsonl`), body);
}

/** The digest of a night the reader must accept; fails loudly when it refuses one. */
function digestOf(night = '2026-10-28'): NightDigest {
  const read = readNight(runsDir, night);
  if (!read.ok) throw new Error(`expected a readable night, got ${read.reason}`);
  return read.digest;
}

describe('readNight on the checked-in fixture', () => {
  // runs/ is a real night: read-only, never written, never copied over.
  const fixture = join('runs', '2026-10-28.jsonl');

  it('renders five jobs and one bad line from 2026-10-28', () => {
    const bytes = readFileSync(fixture);

    const read = readNight('runs', '2026-10-28');
    if (!read.ok) throw new Error(`expected a readable night, got ${read.reason}`);
    const digest = read.digest;

    expect(digest.night).toBe('2026-10-28');
    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest.rows).toEqual([
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
    expect(readFileSync(fixture)).toEqual(bytes);
  });
});

describe('readNight', () => {
  it('reads an empty night as no rows, no bad lines and zero counts', () => {
    writeNight('');

    expect(readNight(runsDir, '2026-10-28')).toEqual({
      ok: true,
      digest: { night: '2026-10-28', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } },
    });
  });

  it.each([
    ['traversal', '../2026-10-28'],
    ['parent directory', '..'],
    ['traversal inside a shaped name', '2026-10-28/../2026-10-28'],
    ['encoded traversal', '%2e%2e%2f2026-10-28'],
    ['encoded separator', '2026%2D10%2D28'],
    ['absolute path', '/etc/passwd'],
    ['file extension included', '2026-10-28.jsonl'],
    ['unpadded month', '2026-1-28'],
    ['trailing newline', '2026-10-28\n'],
    ['empty', ''],
  ])('rejects a %s night name as invalid', (_label, night) => {
    writeNight('{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok"}\n');

    expect(readNight(runsDir, night)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('counts malformed and off-shape lines without losing the rest of the night', () => {
    writeNight(
      [
        'not json at all',
        '{"at":"2026-10-28T23:00:00+01:00","job":"lane/sync","status":"done"}',
        '{"at":42,"job":"lane/sync","status":"ok"}',
        '{"at":"2026-10-28T23:00:00+01:00","job":null,"status":"ok"}',
        '{"at":"2026-10-28T23:00:00+01:00","job":"lane/sync","status":"ok","owner":7}',
        '{"at":"2026-10-28T23:00:00+01:00","job":"lane/sync","status":"ok","error":false}',
        '["lane/sync","ok"]',
        'null',
        '',
        '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
      ].join('\n') + '\n',
    );

    const digest = digestOf();

    expect(digest.badLines).toBe(9);
    expect(digest.rows.map((row) => row.job)).toEqual(['lane/sync']);
    expect(digest.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('counts an event whose error is present but not a string, null included', () => {
    writeNight(
      [
        '{"at":"2026-10-28T23:00:00+01:00","job":"lane/sync","status":"fail","error":null}',
        '{"at":"2026-10-28T23:00:01+01:00","job":"lane/sync","status":"fail","error":"x"}',
      ].join('\n') + '\n',
    );

    const digest = digestOf();

    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 0, retry: 0, fail: 1 });
    expect(digest.rows).toEqual([
      {
        job: 'lane/sync',
        owner: null,
        runs: 1,
        retries: 0,
        status: 'fail',
        error: 'x',
        firstAt: '2026-10-28T23:00:01+01:00',
        lastAt: '2026-10-28T23:00:01+01:00',
      },
    ]);
  });

  it('keeps rows whose owner is null or absent and leaves the field null', () => {
    writeNight(
      [
        '{"at":"2026-10-29T05:41:09+01:00","job":"digest/render","status":"ok","owner":null}',
        '{"at":"2026-10-29T04:00:01+01:00","job":"notes/backup","status":"fail","error":"quota exceeded"}',
      ].join('\n') + '\n',
    );

    const digest = digestOf();

    expect(digest.rows).toEqual([
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

  it('takes status, owner and error from the last valid event', () => {
    writeNight(
      [
        '{"at":"2026-10-29T01:30:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
        '{"at":"2026-10-29T01:37:00+01:00","job":"fixtures/refresh","status":"ok","owner":"lane-07"}',
      ].join('\n') + '\n',
    );

    const digest = digestOf();

    expect(digest.rows).toEqual([
      {
        job: 'fixtures/refresh',
        owner: 'lane-07',
        runs: 2,
        retries: 1,
        status: 'ok',
        error: null,
        firstAt: '2026-10-29T01:30:00+01:00',
        lastAt: '2026-10-29T01:37:00+01:00',
      },
    ]);
  });

  it('counts a retry that later succeeded as one retry and one ok event', () => {
    writeNight(
      [
        '{"at":"2026-10-29T01:30:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
        '{"at":"2026-10-29T01:31:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
        '{"at":"2026-10-29T01:37:00+01:00","job":"fixtures/refresh","status":"ok","owner":"rook"}',
        '{"at":"2026-10-29T04:00:01+01:00","job":"notes/backup","status":"fail","owner":"lane-07","error":"quota exceeded"}',
      ].join('\n') + '\n',
    );

    const digest = digestOf();

    expect(digest.counts).toEqual({ ok: 1, retry: 2, fail: 1 });
    expect(digest.rows[0]).toMatchObject({ job: 'fixtures/refresh', runs: 3, retries: 2, status: 'ok' });
  });

  it('follows source-line order when the timestamps disagree with it', () => {
    writeNight(
      [
        '{"at":"2026-10-29T05:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
        '{"at":"2026-10-28T23:00:00+01:00","job":"lane/sync","status":"retry","owner":"rook","error":"lock held"}',
      ].join('\n') + '\n',
    );

    const digest = digestOf();

    // The later line is the earlier timestamp: first/last are where the lines were, not where time was.
    expect(digest.rows).toEqual([
      {
        job: 'lane/sync',
        owner: 'rook',
        runs: 2,
        retries: 1,
        status: 'retry',
        error: 'lock held',
        firstAt: '2026-10-29T05:00:00+01:00',
        lastAt: '2026-10-28T23:00:00+01:00',
      },
    ]);
  });

  it('clears a job\'s owner and error when its last valid event carries neither', () => {
    writeNight(
      [
        '{"at":"2026-10-29T01:30:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
        '{"at":"2026-10-29T01:37:00+01:00","job":"fixtures/refresh","status":"ok"}',
        '{"at":"2026-10-29T02:00:00+01:00","job":"lane/sync","status":"retry","owner":"rook","error":"lock held"}',
        '{"at":"2026-10-29T02:01:00+01:00","job":"lane/sync","status":"ok","owner":null}',
      ].join('\n') + '\n',
    );

    const digest = digestOf();

    // Omitted and explicit null both clear the owner; an omitted error clears the error too.
    // (`error: null` is off-shape now, so it is not how a log clears an error.)
    expect(digest.rows).toEqual([
      {
        job: 'fixtures/refresh',
        owner: null,
        runs: 2,
        retries: 1,
        status: 'ok',
        error: null,
        firstAt: '2026-10-29T01:30:00+01:00',
        lastAt: '2026-10-29T01:37:00+01:00',
      },
      {
        job: 'lane/sync',
        owner: null,
        runs: 2,
        retries: 1,
        status: 'ok',
        error: null,
        firstAt: '2026-10-29T02:00:00+01:00',
        lastAt: '2026-10-29T02:01:00+01:00',
      },
    ]);
  });

  it('ends a fail, ok, fail sequence on fail and counts only retry events as retries', () => {
    writeNight(
      [
        '{"at":"2026-10-29T04:00:01+01:00","job":"notes/backup","status":"fail","owner":"lane-07","error":"quota exceeded"}',
        '{"at":"2026-10-29T04:10:01+01:00","job":"notes/backup","status":"retry","owner":"lane-07","error":"quota exceeded"}',
        '{"at":"2026-10-29T04:20:01+01:00","job":"notes/backup","status":"ok","owner":"lane-07"}',
        '{"at":"2026-10-29T04:30:01+01:00","job":"notes/backup","status":"fail","owner":"lane-07","error":"quota exceeded"}',
      ].join('\n') + '\n',
    );

    const digest = digestOf();

    expect(digest.counts).toEqual({ ok: 1, retry: 1, fail: 2 });
    expect(digest.rows[0]).toMatchObject({
      job: 'notes/backup',
      runs: 4,
      retries: 1,
      status: 'fail',
      error: 'quota exceeded',
      lastAt: '2026-10-29T04:30:01+01:00',
    });
  });

  it('keeps timestamp strings exactly as written, offsets included', () => {
    writeNight(
      [
        '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok"}',
        '{"at":"2026-10-29T05:00:04-04:00","job":"lane/sync","status":"ok"}',
      ].join('\n') + '\n',
    );

    const digest = digestOf();

    expect(digest.rows[0].firstAt).toBe('2026-10-28T23:00:02+01:00');
    expect(digest.rows[0].lastAt).toBe('2026-10-29T05:00:04-04:00');
  });

  it('sorts rows lexically by job whatever order the log wrote them', () => {
    writeNight(
      [
        '{"at":"2026-10-29T04:00:01+01:00","job":"rig/rotate-logs","status":"ok"}',
        '{"at":"2026-10-29T05:00:04+01:00","job":"notes/backup","status":"ok"}',
        '{"at":"2026-10-29T03:00:04+01:00","job":"lane/sync","status":"ok"}',
      ].join('\n') + '\n',
    );

    const digest = digestOf();

    expect(digest.rows.map((row) => row.job)).toEqual(['lane/sync', 'notes/backup', 'rig/rotate-logs']);
  });

  it('turns a single valid event into one row', () => {
    writeNight('{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok","owner":"rook"}\n');

    expect(readNight(runsDir, '2026-10-28')).toEqual({
      ok: true,
      digest: {
        night: '2026-10-28',
        rows: [
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
        ],
        badLines: 0,
        counts: { ok: 1, retry: 0, fail: 0 },
      },
    });
  });

  it('reports a night whose file is not there as missing', () => {
    expect(readNight(runsDir, '2026-10-28')).toEqual({ ok: false, reason: 'missing' });
  });

  it('reports a runs directory that is not there as missing', () => {
    expect(readNight(join(runsDir, 'no-such-dir'), '2026-10-28')).toEqual({ ok: false, reason: 'missing' });
  });

  it('reports a directory in place of the night file as unreadable', () => {
    mkdirSync(join(runsDir, '2026-10-28.jsonl'));

    expect(readNight(runsDir, '2026-10-28')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('reports a symlinked night as unreadable rather than following it', () => {
    const target = join(runsDir, 'elsewhere.jsonl');
    writeFileSync(target, '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok"}\n');
    symlinkSync(target, join(runsDir, '2026-10-28.jsonl'));

    expect(readNight(runsDir, '2026-10-28')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('reports a night past the size cap as unreadable and reads one under it', () => {
    const file = join(runsDir, '2026-10-28.jsonl');
    writeNight('{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok"}\n');

    // Under the cap, a real night reads as usual.
    expect(digestOf().rows).toHaveLength(1);

    // Sparse, so the cap costs no disk: the size alone is what the reader refuses.
    truncateSync(file, 4 * 1024 * 1024 + 1);

    expect(readNight(runsDir, '2026-10-28')).toEqual({ ok: false, reason: 'unreadable' });
  });

  // A synchronous open that blocks cannot be interrupted by a Vitest timeout, so this read runs in
  // a child of its own: the parent kills it and fails if the answer does not come back in time.
  it('reports a FIFO with no writer as unreadable without blocking', async () => {
    const fifo = join(runsDir, '2026-10-28.jsonl');
    execFileSync('mkfifo', [fifo]);

    const reader = pathToFileURL(join(process.cwd(), 'src', 'digest', 'reader.ts')).href;
    const script =
      `import(${JSON.stringify(reader)}).then(({ readNight }) => ` +
      `process.stdout.write(JSON.stringify(readNight(${JSON.stringify(runsDir)}, '2026-10-28'))));`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--eval', script], { stdio: ['ignore', 'pipe', 'ignore'] });

    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    const started = Date.now();
    let timedOut = false;
    const killer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 3_000);
    const exitCode = await new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    clearTimeout(killer);

    expect(timedOut).toBe(false);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(exitCode).toBe(0);
    expect(Buffer.concat(chunks).toString()).toBe(JSON.stringify({ ok: false, reason: 'unreadable' }));
  }, 10_000);
});

describe('listNights', () => {
  it('lists matching nights newest first, ignoring other files, directories and symlinks', () => {
    writeNight('', '2026-10-27');
    writeNight('', '2026-10-28');
    writeNight('', '2026-11-01');
    writeFileSync(join(runsDir, 'notes.txt'), '');
    mkdirSync(join(runsDir, '2026-10-30.jsonl'));
    symlinkSync(join(runsDir, '2026-10-28.jsonl'), join(runsDir, '2026-10-31.jsonl'));

    expect(listNights(runsDir)).toEqual({ ok: true, nights: ['2026-11-01', '2026-10-28', '2026-10-27'] });
  });

  it('reports a runs directory that is not there as not listable, not as an empty list', () => {
    expect(listNights(join(runsDir, 'no-such-dir'))).toEqual({ ok: false });
  });

  it('reports a runs path that is a file, not a directory, as not listable', () => {
    const notADirectory = join(runsDir, 'not-a-directory');
    writeFileSync(notADirectory, '');

    expect(listNights(notADirectory)).toEqual({ ok: false });
  });

  it('lists the checked-in nights newest first', () => {
    expect(listNights('runs')).toEqual({ ok: true, nights: ['2026-10-28', '2026-10-27'] });
  });
});
