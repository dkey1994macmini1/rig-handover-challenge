import type { DigestRow, NightDigest } from '../digest/types.js';

/** The styleguide's em dash: absent, null and empty all read the same way. */
const orDash = (text: string | null | undefined) => (text === undefined || text === null || text === '' ? '—' : text);

/**
 * A night the reader could not read: a fault, not a missing night. One plain line, never a path and
 * never a stack trace — the routes answer it with a 500.
 */
export function DigestUnreadable({ night }: { night: string }) {
  return (
    <>
      <h1>digest {night}</h1>
      <p class="warn">this night could not be read</p>
    </>
  );
}

/**
 * The eight columns, named once: the header and every cell's `data-label` come from this list, so a
 * stacked narrow-screen row cannot label a value with the wrong column.
 */
const COLUMNS: { label: string; cell: (row: DigestRow) => string }[] = [
  { label: 'job', cell: (row) => row.job },
  { label: 'owner', cell: (row) => orDash(row.owner) },
  { label: 'runs', cell: (row) => String(row.runs) },
  { label: 'retries', cell: (row) => String(row.retries) },
  { label: 'last status', cell: (row) => row.status },
  { label: 'last error', cell: (row) => orDash(row.error) },
  { label: 'first', cell: (row) => row.firstAt },
  { label: 'last', cell: (row) => row.lastAt },
];

export function Digest({ digest }: { digest: NightDigest }) {
  return (
    <>
      <h1>digest {digest.night}</h1>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table class="digest">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr class={row.retries >= 3 || row.status === 'fail' ? 'warn' : undefined}>
                {COLUMNS.map((column) => (
                  <td data-label={column.label}>{column.cell(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {digest.badLines > 0 ? (
        <p class="mute">
          {digest.badLines} {digest.badLines === 1 ? 'line' : 'lines'} unreadable
        </p>
      ) : null}
    </>
  );
}
