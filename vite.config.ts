import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Relative base so the build works at https://<user>.github.io/<repo>/.
// basicSsl gives the dev server a self-signed HTTPS cert so phones on the
// same Wi-Fi can open the camera (getUserMedia requires a secure context).
export default defineConfig({
  base: './',
  plugins: [basicSsl()],
  server: { host: true },
  build: { target: 'es2022' },
});
