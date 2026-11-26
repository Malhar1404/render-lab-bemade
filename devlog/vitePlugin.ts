import type { Plugin } from 'vite';

import { DevlogError, createStore, readBody } from './store.mjs';

const MAX_JSON = 2 * 1024 * 1024;
const MAX_IMAGE = 32 * 1024 * 1024;

type Req = { url?: string; method?: string };

type Res = {
  statusCode: number;
  setHeader(name: string, value: string | number): void;
  end(data?: string | Uint8Array): void;
};

const sendJson = (res: Res, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

/**
 * Dev-only API for the dev log (devlog.html). Entries live in devlog/entries,
 * images in devlog/images. Not part of the production build.
 *
 *   GET    /api/devlog/entries            all entries, newest first
 *   POST   /api/devlog/entries            create or update (JSON body)
 *   DELETE /api/devlog/entries/:id        delete the entry and its images
 *   POST   /api/devlog/images/:id?name=f  raw image body; returns { file }
 *   GET    /devlog-images/:id/:file       the image
 *   GET    /api/devlog/plans              all plans (active first, then newest)
 *   POST   /api/devlog/plans/:id/steps/:step  { status: "done" | "todo" }; returns the plan
 *   GET    /devlog-images/plans/:plan/:file   a plan image (devlog/images/plans/<plan>/)
 *   GET    /api/devlog/layout             saved board card positions { positions }
 *   POST   /api/devlog/layout             replace them (an empty `positions` resets the layout)
 */
export function devlogPlugin(): Plugin {
  return {
    name: 'bemade-devlog',
    apply: 'serve',
    configureServer(server) {
      const store = createStore(server.config.root);

      server.middlewares.use(async (rawReq, rawRes, next) => {
        // Node's http types are not installed here; these are the parts used.
        const req = rawReq as unknown as Req;
        const res = rawRes as unknown as Res;
        const url = new URL(req.url ?? '/', 'http://localhost');
        const parts = url.pathname.split('/').filter(Boolean).map((p) => {
          try {
            return decodeURIComponent(p);
          } catch {
            return '\0';
          }
        });
        const isApi = parts[0] === 'api' && parts[1] === 'devlog';
        const isImage = parts[0] === 'devlog-images';
        if (!isApi && !isImage) return next();
        const method = req.method ?? 'GET';

        try {
          // Images: /devlog-images/<id>/<file>
          if (isImage) {
            if (method !== 'GET' && method !== 'HEAD') throw new DevlogError('Method not allowed', 405);
            const image =
              parts.length === 3
                ? store.readImage(parts[1], parts[2])
                : parts.length === 4 && parts[1] === 'plans'
                  ? store.readPlanImage(parts[2], parts[3])
                  : null;
            if (!image) throw new DevlogError('Not found', 404);
            res.statusCode = 200;
            res.setHeader('Content-Type', image.type);
            res.setHeader('Content-Length', image.data.length);
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.end(method === 'HEAD' ? undefined : image.data);
            return;
          }

          // /api/devlog/entries[/<id>]
          if (parts[2] === 'entries' && parts.length === 3) {
            if (method === 'GET') return sendJson(res, 200, store.listEntries());
            if (method === 'POST') {
              const body = await readBody(req, MAX_JSON);
              let input: unknown;
              try {
                input = JSON.parse(new TextDecoder().decode(body));
              } catch {
                throw new DevlogError('Body is not valid JSON');
              }
              return sendJson(res, 200, store.saveEntry(input, { prune: true }));
            }
            throw new DevlogError('Method not allowed', 405);
          }
          if (parts[2] === 'entries' && parts.length === 4) {
            if (method === 'GET') {
              const entry = store.getEntry(parts[3]);
              if (!entry) throw new DevlogError('Not found', 404);
              return sendJson(res, 200, entry);
            }
            if (method === 'DELETE') {
              if (!store.deleteEntry(parts[3])) throw new DevlogError('Not found', 404);
              return sendJson(res, 200, { deleted: parts[3] });
            }
            throw new DevlogError('Method not allowed', 405);
          }

          // /api/devlog/plans, /api/devlog/plans/<id>/steps/<step>
          if (parts[2] === 'plans' && parts.length === 3) {
            if (method !== 'GET') throw new DevlogError('Method not allowed', 405);
            return sendJson(res, 200, store.listPlans());
          }
          if (parts[2] === 'plans' && parts.length === 6 && parts[4] === 'steps') {
            if (method !== 'POST') throw new DevlogError('Method not allowed', 405);
            const body = await readBody(req, MAX_JSON);
            let input: { status?: string };
            try {
              input = JSON.parse(new TextDecoder().decode(body));
            } catch {
              throw new DevlogError('Body is not valid JSON');
            }
            return sendJson(res, 200, store.setPlanStep(parts[3], parts[5], String(input?.status)));
          }

          // /api/devlog/layout
          if (parts[2] === 'layout' && parts.length === 3) {
            if (method === 'GET') return sendJson(res, 200, store.getLayout());
            if (method === 'POST') {
              const body = await readBody(req, MAX_JSON);
              let input: unknown;
              try {
                input = JSON.parse(new TextDecoder().decode(body));
              } catch {
                throw new DevlogError('Body is not valid JSON');
              }
              return sendJson(res, 200, store.saveLayout(input));
            }
            throw new DevlogError('Method not allowed', 405);
          }

          // /api/devlog/images/<id>?name=<file>
          if (parts[2] === 'images' && parts.length === 4) {
            if (method !== 'POST') throw new DevlogError('Method not allowed', 405);
            const bytes = await readBody(req, MAX_IMAGE);
            if (!bytes.length) throw new DevlogError('Empty image body');
            const file = store.saveImage(parts[3], url.searchParams.get('name') ?? 'image.png', bytes);
            return sendJson(res, 200, { file });
          }

          throw new DevlogError('Not found', 404);
        } catch (err) {
          const status = err instanceof DevlogError ? err.status : 500;
          if (status === 500) console.error('[devlog]', err);
          sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
