import { randomInt } from 'node:crypto';

/** Uniform integer in [min, max), CSPRNG. Swappable in tests. */
export type Rng = (min: number, max: number) => number;
export const secureRng: Rng = (min, max) => randomInt(min, max);
