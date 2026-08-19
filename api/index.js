import { handleRequest } from '../src/app.js';

/**
 * Vercel serverless entry point. vercel.json rewrites every path here, so the
 * same router serves /manifest.json, /stream/... and /debug/... as it does locally.
 */
export default function handler(req, res) {
  return handleRequest(req, res);
}
