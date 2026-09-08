import { describe, expect, test } from 'vitest';

import { formatRemaining } from './formatRemaining';

describe('countdown display', () => {
  test('REGRESSION: does not hardcode the minutes digit', () => {
    // A 900s rehearsal deadline rendered as "0:837" before this was fixed,
    // which reads as broken on camera.
    expect(formatRemaining(837)).toBe('13:57');
    expect(formatRemaining(900)).toBe('15:00');
  });

  test('the 60s demo deadline renders as expected', () => {
    expect(formatRemaining(60)).toBe('1:00');
    expect(formatRemaining(59)).toBe('0:59');
    expect(formatRemaining(9)).toBe('0:09');   // always two second-digits
    expect(formatRemaining(0)).toBe('0:00');
  });

  test('renders a placeholder before the first tick', () => {
    expect(formatRemaining(null)).toBe('--:--');
  });
});
