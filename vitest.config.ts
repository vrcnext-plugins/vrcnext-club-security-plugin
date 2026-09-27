import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Sources use `.js` specifiers so the bridge's bundler resolves them; Vite maps them back.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
