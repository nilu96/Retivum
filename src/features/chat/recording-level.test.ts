import { describe, expect, it } from 'vitest';
import { recordingPulseLevel } from './recording-level';

describe('recordingPulseLevel', () => {
  it('ignores the microphone noise floor and clamps loud input', () => {
    expect(recordingPulseLevel(0.004)).toBe(0);
    expect(recordingPulseLevel(0.25)).toBe(1);
    expect(recordingPulseLevel(1)).toBe(1);
  });

  it('responds more strongly to changes in quiet audio than loud audio', () => {
    const quietDifference = recordingPulseLevel(0.02) - recordingPulseLevel(0.01);
    const loudDifference = recordingPulseLevel(0.2) - recordingPulseLevel(0.19);

    expect(recordingPulseLevel(0.01)).toBeGreaterThan(0.2);
    expect(quietDifference).toBeGreaterThan(loudDifference * 6);
  });
});
