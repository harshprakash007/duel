import { describe, expect, it } from 'vitest';
import { selectProblems, type CandidateProblem } from '../../src/modules/problems/picker.service';
import { PICKER_DEFAULTS } from '@duel/shared';

describe('selectProblems unit tests', () => {
  const createCandidates = (ratings: number[]): CandidateProblem[] =>
    ratings.map((rating, idx) => ({
      id: idx + 1,
      contestId: 1000 + idx,
      index: 'A',
      name: `Problem ${idx + 1}`,
      rating,
      tags: ['math'],
    }));

  it('selects N problems distributed across the rating band', () => {
    // When window is 0, target must match exact rating
    const candidates = createCandidates([800, 900, 1000, 1100, 1200]);
    const picked = selectProblems(candidates, 3, 800, 1200, {
      ...PICKER_DEFAULTS,
      snap: 100,
      window: 0,
      windowStep: 100,
    });

    expect(picked).toHaveLength(3);
    // For n=3, min=800, max=1200:
    // Slot 0 target = 800
    // Slot 1 target = 1000
    // Slot 2 target = 1200
    expect(picked[0]!.rating).toBe(800);
    expect(picked[1]!.rating).toBe(1000);
    expect(picked[2]!.rating).toBe(1200);
  });

  it('samples without replacement (no duplicate problems)', () => {
    const candidates = createCandidates([800, 800, 800, 1200, 1200]);
    const picked = selectProblems(candidates, 4, 800, 1200, PICKER_DEFAULTS);

    expect(picked).toHaveLength(4);
    const ids = picked.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(4);
  });

  it('snaps target ratings according to snap param', () => {
    // If raw target is 833 (e.g. 800 to 1100 for 3 problems: 800, 950, 1100)
    // with snap = 100, target 950 snaps to 1000
    const candidates = createCandidates([800, 1000, 1100]);
    const picked = selectProblems(candidates, 3, 800, 1100, {
      ...PICKER_DEFAULTS,
      snap: 100,
      window: 0,
      windowStep: 100,
    });

    expect(picked).toHaveLength(3);
    expect(picked[0]!.rating).toBe(800);
    expect(picked[1]!.rating).toBe(1000);
    expect(picked[2]!.rating).toBe(1100);
  });

  it('widens the search window if no candidate is found in the initial window', () => {
    // Target for slot 1 is 1000. Window 0 has no candidate at 1000.
    // Window widening will widen until it reaches 900.
    const candidates = createCandidates([800, 900, 1400]);
    const picked = selectProblems(candidates, 3, 800, 1400, {
      ...PICKER_DEFAULTS,
      snap: 100,
      window: 0,
      windowStep: 100,
    });

    expect(picked).toHaveLength(3);
    expect(picked[0]!.rating).toBe(800);
    // Middle slot (target 1100) widened to find 900
    expect(picked[1]!.rating).toBe(900);
    expect(picked[2]!.rating).toBe(1400);
  });

  it('falls back to remaining pool if widening reaches max window', () => {
    // All candidates are 800, target ranges to 2000
    const candidates = createCandidates([800, 800, 800]);
    const picked = selectProblems(candidates, 3, 800, 2000, PICKER_DEFAULTS);

    expect(picked).toHaveLength(3);
    expect(picked.map((p) => p.rating)).toEqual([800, 800, 800]);
  });

  it('throws an error if candidates length is less than requested N', () => {
    const candidates = createCandidates([800, 900]);
    expect(() => selectProblems(candidates, 3, 800, 1200, PICKER_DEFAULTS)).toThrow(
      /Insufficient candidate problems/,
    );
  });
});
