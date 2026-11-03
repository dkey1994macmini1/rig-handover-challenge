import type { NightDigest } from '../digest/types.js';

/** The styleguide's em dash: a field the log left empty reads like one it never carried. */
const orDash = (text: string | null) => (text === null || text === '' ? '—' : text);

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

export function Digest({ digest }: { digest: NightDigest }) {
  return (
    <>
      <h1>digest {digest.night}</h1>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr class={row.retries >= 3 || row.status === 'fail' ? 'warn' : undefined}>
                <td>{row.job}</td>
                <td>{orDash(row.owner)}</td>
                <td>{row.runs}</td>
                <td>{row.retries}</td>
                <td>{row.status}</td>
                <td>{orDash(row.error)}</td>
                <td>{row.firstAt}</td>
                <td>{row.lastAt}</td>
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
