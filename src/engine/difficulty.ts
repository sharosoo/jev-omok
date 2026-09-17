import type { Difficulty } from "@/game/protocol";
import type { DifficultyProfile } from "./types";

/**
 * Difficulty is tuned with blunder gates rather than search depth: a weak level
 * that simply searches less still blocks every four, which feels robotic. A
 * level that sometimes fails to notice a three plays like a human beginner.
 *
 * Latency is dominated by the Jev round trip (~250-900 ms measured), so only
 * `useJev` and `vcfDepth` change the time per move in any noticeable way.
 */
export const PROFILES: Readonly<Record<Difficulty, DifficultyProfile>> = {
  beginner: {
    candidateLimit: 5,
    searchDepth: 0,
    rootWidth: 5,
    innerWidth: 4,
    nodeLimit: 2_000,
    nearBestMargin: 100_000,
    vcfDepth: 0,
    takeFive: 0.85,
    blockFour: 0.65,
    blockThree: 0.4,
    temperature: 1.5,
    blunderRate: 0.2,
    useJev: false,
  },
  easy: {
    candidateLimit: 7,
    searchDepth: 2,
    rootWidth: 7,
    innerWidth: 5,
    nodeLimit: 4_000,
    nearBestMargin: 20_000,
    vcfDepth: 0,
    takeFive: 0.95,
    blockFour: 0.85,
    blockThree: 0.7,
    temperature: 0.9,
    blunderRate: 0.08,
    useJev: true,
  },
  medium: {
    candidateLimit: 10,
    searchDepth: 4,
    rootWidth: 10,
    innerWidth: 7,
    nodeLimit: 12_000,
    nearBestMargin: 6_000,
    vcfDepth: 4,
    takeFive: 1,
    blockFour: 0.98,
    blockThree: 0.92,
    temperature: 0.45,
    blunderRate: 0.02,
    useJev: true,
  },
  hard: {
    candidateLimit: 12,
    searchDepth: 6,
    rootWidth: 12,
    innerWidth: 8,
    nodeLimit: 40_000,
    nearBestMargin: 1_500,
    vcfDepth: 8,
    takeFive: 1,
    blockFour: 1,
    blockThree: 1,
    temperature: 0.15,
    blunderRate: 0,
    useJev: true,
  },
  master: {
    candidateLimit: 12,
    searchDepth: 6,
    rootWidth: 14,
    innerWidth: 10,
    nodeLimit: 90_000,
    nearBestMargin: 600,
    vcfDepth: 12,
    takeFive: 1,
    blockFour: 1,
    blockThree: 1,
    temperature: 0,
    blunderRate: 0,
    useJev: true,
  },
};

/**
 * Small deterministic PRNG (mulberry32). A seed keeps a turn reproducible for
 * tests and for replaying a reported game; without one the caller passes a
 * random seed per request.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Samples an index from `weights` after re-shaping it with a temperature.
 * T = 0 is argmax; larger T flattens the distribution toward uniform, which is
 * how a weaker level ends up on its second or third choice.
 */
export function sampleIndex(weights: readonly number[], temperature: number, next: () => number) {
  if (weights.length === 0) return -1;
  let bestIndex = 0;
  for (let i = 1; i < weights.length; i++) {
    if ((weights[i] as number) > (weights[bestIndex] as number)) bestIndex = i;
  }
  if (temperature <= 0) return bestIndex;

  const shaped = weights.map((w) => Math.pow(Math.max(w, 0) + 1e-6, 1 / temperature));
  const total = shaped.reduce((sum, w) => sum + w, 0);
  if (!Number.isFinite(total) || total <= 0) return bestIndex;

  let roll = next() * total;
  for (let i = 0; i < shaped.length; i++) {
    roll -= shaped[i] as number;
    if (roll <= 0) return i;
  }
  return shaped.length - 1;
}
