import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import sceneHandler from './api/scene.js'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'scene-api-dev-middleware',
      configureServer(server) {
        server.middlewares.use('/api/scene', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: { message: 'Method not allowed' } }));
            return;
          }

          try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const rawBody = Buffer.concat(chunks).toString('utf8');
            req.body = rawBody ? JSON.parse(rawBody) : {};
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
            return;
          }

          const response = {
            statusCode: 200,
            body: null,
            status(code) {
              this.statusCode = code;
              return this;
            },
            json(payload) {
              this.body = payload;
              return this;
            },
          };

          await sceneHandler(req, response);
          res.statusCode = response.statusCode;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(response.body ?? {}));
        });
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
})
