// Confidence decay math + threshold constants.
// See README.md for the full formula. Tuning knobs live here in one place.

export const CONFIDENCE_HIGH = 70; // >= 70: state the fact directly
export const CONFIDENCE_LOW = 40; //  40-69: state with a caveat; < 40: "I might be wrong"
export const CONFIDENCE_MID = 45; //  contested facts can never read above this
export const CONTESTED_CAP = CONFIDENCE_MID;
export const STALE_FLOOR = 15; // below this effective confidence => mark 'stale'

export const DECAY_POINTS_PER_DAY = 2; // ~2 confidence points per day since confirmation
export const DECAY_CAP = 40; // max decay from time alone
export const CONFIRM_BOOST = 10; // corroboration raises base_confidence
export const CONTRADICTION_PENALTY = 30; // both sides lose this when contradicted

export function daysSince(isoTimestamp) {
  const ts = new Date(isoTimestamp).getTime();
  return (Date.now() - ts) / 86400000;
}

export function decayFor(isoTimestamp) {
  return Math.min(DECAY_CAP, Math.max(0, daysSince(isoTimestamp) * DECAY_POINTS_PER_DAY));
}

// Effective confidence of a memory at read time. Applied on every retrieval,
// never stored — so confidence is visibly dynamic over time.
export function effectiveConfidence(mem) {
  const decay = decayFor(mem.last_confirmed_at);
  let eff = (mem.base_confidence ?? mem.confidence) - decay;
  if (mem.status === 'contested') eff = Math.min(eff, CONTESTED_CAP);
  return Math.max(0, Math.round(eff));
}

export function confidenceTier(effective) {
  if (effective >= CONFIDENCE_HIGH) return 'high';
  if (effective >= CONFIDENCE_LOW) return 'medium';
  return 'low';
}

// A memory is a "forget candidate" once time decay has suppressed it below the
// floor. Read paths flip status to 'stale' and never answer confidently with it.
export function isStaleCandidate(mem, effective = effectiveConfidence(mem)) {
  return mem.status !== 'revoked' && effective < STALE_FLOOR;
}

export function bumpedBase(base, delta) {
  return Math.max(0, Math.min(100, (base ?? 0) + delta));
}