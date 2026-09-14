/**
 * The pipeline's only source of the current time. Injected so that a run is
 * reproducible in tests and never depends on the machine's clock.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
