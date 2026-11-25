import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { publicApiOrigin } from './src/lib/public-api-origin.js'

// https://vite.dev/config/
export default defineConfig(({ command, mode, isPreview }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_API_BASE': JSON.stringify(publicApiOrigin(
      isPreview ? undefined : loadEnv(mode, process.cwd()).VITE_API_BASE,
      { build: command === 'build' },
    )),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  publicDir: 'public',
  server: {
    proxy: {
      '^/(api|control|studio|sync)/v1(?:/|$)': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rolldownOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-dom') || id.includes('node_modules/react/')) return 'react';
          if (id.includes('@radix-ui')) return 'radix';
          return 'vendor';
        },
      },
    },
  },
}))
