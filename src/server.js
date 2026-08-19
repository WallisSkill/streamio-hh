import http from 'node:http';
import { CONFIG } from './config.js';
import { MANIFEST } from './manifest.js';
import { handleRequest } from './app.js';

http.createServer(handleRequest).listen(CONFIG.port, () => {
  console.log(`[addon] ${MANIFEST.name} on http://localhost:${CONFIG.port}/manifest.json`);
  console.log(
    `[addon] kkphim=${CONFIG.enableKkphim} ophim=${CONFIG.enableOphim} hh3d=${CONFIG.enableHh3d}`,
  );
});
