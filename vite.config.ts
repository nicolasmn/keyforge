import { defineConfig, configDefaults } from 'vitest/config'
import solidPlugin from 'vite-plugin-solid'
import { resolve } from 'path'

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
  },
  test: {
    environment: 'node',
    globals: true,
    // Never pick up compiled copies in dist/ — a stale build there used to
    // double-count every suite and fail against newer src expectations.
    exclude: [...configDefaults.exclude, 'dist/**'],
    alias: {
      '@/': resolve(__dirname, './src/'),
    },
  },
})
