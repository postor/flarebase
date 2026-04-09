import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js']
  },
  build: {
    lib: {
      entry: './src/index.js',
      name: 'FlarebaseVue',
      formats: ['es', 'umd']
    },
    rollupOptions: {
      external: ['vue', 'socket.io-client'],
      output: {
        globals: {
          vue: 'Vue'
        }
      }
    }
  }
});
