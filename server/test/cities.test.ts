import { describe, expect, it } from 'vitest';
import { cityFor } from '../src/cities';

describe('cityFor', () => {
  it('finds a launch city and rejects places outside every service area', () => {
    expect(cityFor(40.7128, -74.006)?.name).toBe('New York');
    expect(cityFor(51.52, -0.12)?.name).toBe('London');
    expect(cityFor(40.0821, -74.2097)).toBeNull(); // Lakewood NJ, ~90 km from New York
    expect(cityFor(0, 0)).toBeNull();
  });
});
