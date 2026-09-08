/**
 * MM:SS for the witness countdown.
 *
 * Do NOT hardcode the minutes digit. A 900s rehearsal deadline rendered as
 * "0:837" before this existed, which reads as broken on camera.
 */
export const formatRemaining = (seconds: number | null): string =>
  seconds === null
    ? '--:--'
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
