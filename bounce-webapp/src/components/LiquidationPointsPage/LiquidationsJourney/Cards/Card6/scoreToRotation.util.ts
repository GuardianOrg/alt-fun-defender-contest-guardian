const MIN_DEG = 0;
const MAX_DEG = 180;
const TOTAL_DEG = MAX_DEG - MIN_DEG;

const SEGMENTS = 5;
const GAP_DEG = 12; // tweak visually
const TOTAL_GAP_DEG = GAP_DEG * (SEGMENTS - 1);

const SEGMENT_DEG = (TOTAL_DEG - TOTAL_GAP_DEG) / SEGMENTS;

const SCORE_SEGMENTS = [
  { min: 300, max: 579 },
  { min: 580, max: 669 },
  { min: 670, max: 739 },
  { min: 740, max: 799 },
  { min: 800, max: 850 },
];

export const scoreToDegrees = (score: number) => {
  // Clamp score
  const clampedScore = Math.min(Math.max(score, 300), 850);

  // Find segment
  const segmentIndex = SCORE_SEGMENTS.findIndex(
    (s) => clampedScore >= s.min && clampedScore <= s.max,
  );

  const segment = SCORE_SEGMENTS[segmentIndex];

  // Progress within segment (0 → 1)
  const segmentProgress =
    (clampedScore - segment.min) / (segment.max - segment.min);

  // Angle offset:
  // - segment widths
  // - plus gaps before this segment
  const angleOffset = segmentIndex * SEGMENT_DEG + segmentIndex * GAP_DEG;

  return MIN_DEG + angleOffset + segmentProgress * SEGMENT_DEG;
};
