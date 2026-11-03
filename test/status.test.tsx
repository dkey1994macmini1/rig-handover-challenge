import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

/** A board over a temporary runs directory: the real runs/ fixtures are never written. */
let runsDir: string;

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-status-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

async function board(overrides: Partial<RigConfig> = {}): Promise<string> {
  const res = await createApp({ ...config, runsDir, ...overrides }).request('/');
  expect(res.status).toBe(200);
  return res.text();
}

describe('status board', () => {
  it('shows the lane banner and the nights on disk', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('2026-10-28');
  });

  it('health answers with the lane id', async () => {
    const res = await createApp(config).request('/health');
    expect(await res.json()).toEqual({ ok: true, lane: 'lane-07' });
  });
});

describe('status board nights', () => {
  it('links each night on disk to its digest', async () => {
    writeFileSync(join(runsDir, '2026-10-27.jsonl'), '');
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), '');

    const html = await board();

    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
  });

  it('shows the night\'s valid event counts beside its link, retries that later succeeded included', async () => {
    writeFileSync(
      join(runsDir, '2026-10-28.jsonl'),
      [
        '{"at":"2026-10-29T01:30:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
        '{"at":"2026-10-29T01:31:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
        '{"at":"2026-10-29T01:37:00+01:00","job":"fixtures/refresh","status":"ok","owner":"rook"}',
        '{"at":"2026-10-29T04:00:01+01:00","job":"notes/backup","status":"fail","owner":"lane-07","error":"quota exceeded"}',
      ].join('\n') + '\n',
    );

    const html = await board();

    expect(html).toContain('ok 1 · retry 2 · fail 1');
  });

  it('leaves malformed lines out of the counts and still lists the night', async () => {
    writeFileSync(
      join(runsDir, '2026-10-28.jsonl'),
      [
        '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
        'not json at all',
        '{"at":"2026-10-29T04:00:01+01:00","job":"notes/backup","status":"fail","error":"quota exceeded"}',
      ].join('\n') + '\n',
    );

    const html = await board();

    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('ok 1 · retry 0 · fail 1');
  });

  it('does not list or link a symlinked night or a file whose name is not a night', async () => {
    writeFileSync(
      join(runsDir, '2026-10-28.jsonl'),
      '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok"}\n',
    );
    writeFileSync(join(runsDir, 'notes.txt'), 'not a night\n');
    symlinkSync(join(runsDir, '2026-10-28.jsonl'), join(runsDir, '2026-10-27.jsonl'));

    const html = await board();

    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).not.toContain('/digest/2026-10-27');
    expect(html).not.toContain('notes.txt');
  });

  it('shows nothing in runs/ for a runs directory that is there and empty', async () => {
    const html = await board();

    expect(html).toContain('nothing in runs/');
    expect(html).not.toContain('/digest/');
  });

  it('says runs/ could not be read, not nothing in runs/, when the runs path is a file', async () => {
    const notADirectory = join(runsDir, 'not-a-directory');
    writeFileSync(notADirectory, '');

    const html = await board({ runsDir: notADirectory });

    expect(html).toContain('runs/ could not be read');
    expect(html).not.toContain('nothing in runs/');
    expect(html).not.toContain('/digest/');
  });

  it('says runs/ could not be read when the runs directory is not there', async () => {
    const html = await board({ runsDir: join(runsDir, 'no-such-dir') });

    expect(html).toContain('runs/ could not be read');
    expect(html).not.toContain('/digest/');
  });

  // A listed night whose bytes cannot be read shows the em dash, never an invented zero. Root can
  // read a 000 file, so this one is skipped where the permission would not bite.
  it.skipIf(process.getuid?.() === 0)('shows an em dash for each count of a night it cannot read', async () => {
    const file = join(runsDir, '2026-10-28.jsonl');
    writeFileSync(file, '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok"}\n');
    chmodSync(file, 0o000);

    try {
      const html = await board();

      expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
      expect(html).toContain('ok — · retry — · fail —');
    } finally {
      chmodSync(file, 0o644);
    }
  });
});
