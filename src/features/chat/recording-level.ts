const RECORDING_NOISE_FLOOR_RMS = 0.004;
const RECORDING_FULL_SCALE_RMS = 0.25;
const RECORDING_LOW_LEVEL_SENSITIVITY = 50;

export function recordingPulseLevel(rms: number): number {
  if (!Number.isFinite(rms) || rms <= RECORDING_NOISE_FLOOR_RMS) return 0;

  const linearLevel = Math.min(
    1,
    (rms - RECORDING_NOISE_FLOOR_RMS)
      / (RECORDING_FULL_SCALE_RMS - RECORDING_NOISE_FLOOR_RMS),
  );

  return Math.log1p(RECORDING_LOW_LEVEL_SENSITIVITY * linearLevel)
    / Math.log1p(RECORDING_LOW_LEVEL_SENSITIVITY);
}
