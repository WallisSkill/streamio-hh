import http from 'node:http';
import { CONFIG } from './config.js';
import { MANIFEST } from './manifest.js';
import { handleRequest } from './app.js';

http.createServer(handleRequest).listen(CONFIG.port, () => {
  console.log(`[addon] ${MANIFEST.name} on http://localhost:${CONFIG.port}/manifest.json`);
  console.log(
    `[addon] kkphim=${CONFIG.enableKkphim} ophim=${CONFIG.enableOphim}` +
      ` nguonc=${CONFIG.enableNguonc} hh3d=${CONFIG.enableHh3d}`,
  );
  // Nguồn C only plays through these two; without them its episodes fall back
  // to an external link, and the line above alone would not explain why.
  if (CONFIG.enableNguonc) {
    console.log(
      `[addon] nguonc streamc=${CONFIG.streamcProxy || '(tắt)'}` +
        ` stremio=${CONFIG.stremioProxy || '(tắt)'}` +
        ` api=${CONFIG.nguoncUpstream ? `qua ${CONFIG.nguoncUpstream}` : 'trực tiếp'}`,
    );
  }
});
