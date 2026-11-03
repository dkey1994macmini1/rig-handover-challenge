import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { loadNightDigest } from './digest/load.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { Digest } from './views/digest.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    const loaded = loadNightDigest(config.runsDir, night);
    if (!loaded.ok && loaded.status === 404) return c.notFound();
    return c.html(
      <Layout title={`digest ${night}`} lane={lane()}>
        {loaded.ok ? (
          <Digest digest={loaded.digest} />
        ) : (
          // A fault, not a missing night: one line, never a stack trace or a path.
          <>
            <h1>digest {night}</h1>
            <p class="warn">this night could not be read</p>
          </>
        )}
      </Layout>,
      loaded.ok ? 200 : 500,
    );
  });

  // The same night, the same reader, the same 404-vs-500: the JSON body carries only what the
  // page shows — the night, its sorted rows and the lines it could not read.
  app.get('/api/digest/:night', (c) => {
    const loaded = loadNightDigest(config.runsDir, c.req.param('night'));
    if (!loaded.ok) return c.body(null, loaded.status);
    const { night, rows, badLines } = loaded.digest;
    return c.json({ night, rows, badLines });
  });

  return app;
}
