import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom', // Use jsdom to simulate browser environment
    globals: true, // Optional: Make Vitest APIs globally available like Jest
  },
});