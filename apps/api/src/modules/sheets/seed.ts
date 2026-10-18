import type { Db } from '../../db/prisma';

export interface SeedSheetDefinition {
  slug: string;
  name: string;
  description: string;
  minRating: number;
  maxRating: number;
  minSolvedCount: number;
  questionCount: number;
  sortOrder: number;
}

export const SEED_SHEETS: SeedSheetDefinition[] = [
  {
    slug: 'l1-warmup',
    name: 'L1 Warm-up',
    description: 'Rating 800–1000. Beginner fundamentals and direct implementations.',
    minRating: 800,
    maxRating: 1000,
    minSolvedCount: 300,
    questionCount: 3,
    sortOrder: 1,
  },
  {
    slug: 'l2-rookie',
    name: 'L2 Rookie',
    description: 'Rating 1000–1200. Elementary algorithms, sorting, and simulation.',
    minRating: 1000,
    maxRating: 1200,
    minSolvedCount: 300,
    questionCount: 3,
    sortOrder: 2,
  },
  {
    slug: 'l3-challenger',
    name: 'L3 Challenger',
    description: 'Rating 1200–1400. Greedy, binary search, and math foundations.',
    minRating: 1200,
    maxRating: 1400,
    minSolvedCount: 300,
    questionCount: 3,
    sortOrder: 3,
  },
  {
    slug: 'l4-contender',
    name: 'L4 Contender',
    description: 'Rating 1400–1700. Dynamic programming, graph traversal, and data structures.',
    minRating: 1400,
    maxRating: 1700,
    minSolvedCount: 300,
    questionCount: 3,
    sortOrder: 4,
  },
  {
    slug: 'l5-expert',
    name: 'L5 Expert',
    description: 'Rating 1700–2000. Advanced DP, segment trees, number theory, and combinatorics.',
    minRating: 1700,
    maxRating: 2000,
    minSolvedCount: 300,
    questionCount: 3,
    sortOrder: 5,
  },
  {
    slug: 'l6-master',
    name: 'L6 Master',
    description: 'Rating 2000–2400. Hard contest problems, flows, complex trees, and game theory.',
    minRating: 2000,
    maxRating: 2400,
    minSolvedCount: 300,
    questionCount: 3,
    sortOrder: 6,
  },
];

export async function seedLevelSheets(db: Db): Promise<void> {
  for (const s of SEED_SHEETS) {
    await db.levelSheet.upsert({
      where: { slug: s.slug },
      update: {
        name: s.name,
        description: s.description,
        minRating: s.minRating,
        maxRating: s.maxRating,
        minSolvedCount: s.minSolvedCount,
        questionCount: s.questionCount,
        sortOrder: s.sortOrder,
        isActive: true,
      },
      create: {
        slug: s.slug,
        name: s.name,
        description: s.description,
        minRating: s.minRating,
        maxRating: s.maxRating,
        minSolvedCount: s.minSolvedCount,
        questionCount: s.questionCount,
        sortOrder: s.sortOrder,
        isActive: true,
      },
    });
  }
}
