import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devPort = Number.parseInt(env.VITE_DEV_PORT || '5178', 10);
  const backendPort = env.PORT || '3008';
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || `http://localhost:${backendPort}`;
  // Perf-pipeline hulpmiddel: laat de lokale frontend tegen een HTTPS remote-backend (Azure DEV)
  // meten. Een remote-backend zet Secure-cookies die de browser niet bewaart over http://localhost.
  // Alleen wanneer expliciet aangezet strippen we Secure/Domain uit Set-Cookie zodat de sessie werkt.
  // Standaard inert -> productie/dev-gedrag ongewijzigd.
  const stripSecureCookies = env.VITE_PROXY_STRIP_SECURE === 'true';

  return {
  plugins: [react()],
  server: {
    // '::' bindt dual-stack, zodat zowel http://127.0.0.1 als http://[::1] werkt.
    // Met de Vite-default ('localhost' -> alleen ::1) weigert 127.0.0.1 de verbinding.
    host: env.VITE_DEV_HOST || '::',
    port: Number.isFinite(devPort) && devPort > 0 ? devPort : 5178,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        cookieDomainRewrite: stripSecureCookies ? '' : undefined,
        configure: stripSecureCookies
          ? (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              const setCookie = proxyRes.headers['set-cookie'];
              if (Array.isArray(setCookie)) {
                proxyRes.headers['set-cookie'] = setCookie.map((c) =>
                  c.replace(/;\s*Secure/gi, '').replace(/;\s*Domain=[^;]+/gi, ''));
              }
            });
          }
          : undefined,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Split zware, zelden-wijzigende libraries in eigen vendor-chunks. Dit haalt ze uit de
    // hoofdbundle (betere caching tussen deploys) en werkt samen met de route-lazy-loading
    // in App.jsx: recharts belandt zo enkel in de admin-chunk-keten, niet in de initiële load.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-fluentui': ['@fluentui/react-components', '@fluentui/react-icons'],
          'vendor-charts': ['recharts'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  };
});
