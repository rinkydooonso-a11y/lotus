import { defineConfig } from 'vitest/config';

// Tests use fixed coordinates (Dublin) that are outside every launch city, so the city gate is off by default.
// test/cities.test.ts turns it on explicitly where the gate itself is under test.
export default defineConfig({
  test: { fileParallelism: false, testTimeout: 20_000, env: { LOTUS_CITY_GATE: 'off' } },
});
