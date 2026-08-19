/**
 * Vercel serverless entry point. vercel.json rewrites every path here, so the
 * same router serves /manifest.json, /stream/... and /debug/... as it does locally.
 *
 * The app is imported lazily inside the handler on purpose: a module that throws
 * while loading would otherwise crash the function before any handler runs, and
 * Vercel would only show an opaque FUNCTION_INVOCATION_FAILED page. This way the
 * real error comes back as readable JSON.
 */
let appPromise;

export default async function handler(req, res) {
  try {
    appPromise ??= import('../src/app.js');
    const { handleRequest } = await appPromise;
    return await handleRequest(req, res);
  } catch (err) {
    appPromise = undefined; // let the next request retry a transient failure
    console.error('[addon] fatal', err);
    if (!res.headersSent) {
      res.writeHead(500, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      });
    }
    res.end(
      JSON.stringify({
        err: err?.message || String(err),
        code: err?.code,
        stack: String(err?.stack || '').split('\n').slice(0, 6),
      }),
    );
  }
}
