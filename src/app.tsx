import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { loadNightDigest } from './digest/load.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { Digest, DigestUnreadable } from './views/digest.js';
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
        {loaded.ok ? <Digest digest={loaded.digest} /> : <DigestUnreadable night={night} />}
      </Layout>,
      loaded.ok ? 200 : 500,
    );
  });

  app.get('/api/digest/:night', (c) => {
    const loaded = loadNightDigest(config.runsDir, c.req.param('night'));
    if (!loaded.ok) return c.body(null, loaded.status);
    const { night, rows, badLines } = loaded.digest;
    return c.json({ night, rows, badLines });
  });

  return app;
}
