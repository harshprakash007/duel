import type { Db } from '../../db/prisma';
import type { LevelSheet } from '../../generated/prisma/client';
import { AppError } from '../../lib/errors';
import type { CreateSheetInput, LevelSheetDto, UpdateSheetInput } from '@duel/shared';

export class SheetsService {
  constructor(private readonly db: Db) {}

  public async listSheets(includeInactive = false): Promise<LevelSheetDto[]> {
    const sheets = await this.db.levelSheet.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    const result: LevelSheetDto[] = [];
    for (const s of sheets) {
      const problemCount = await this.db.problem.count({
        where: {
          isActive: true,
          rating: { gte: s.minRating, lte: s.maxRating },
          solvedCount: { gte: s.minSolvedCount },
        },
      });
      result.push({
        ...s,
        problemCount,
      });
    }

    return result;
  }

  public async getBySlug(slug: string): Promise<LevelSheetDto> {
    const sheet = await this.db.levelSheet.findUnique({
      where: { slug },
    });

    if (!sheet) {
      throw new AppError('NOT_FOUND', `Level sheet "${slug}" not found`);
    }

    const problemCount = await this.db.problem.count({
      where: {
        isActive: true,
        rating: { gte: sheet.minRating, lte: sheet.maxRating },
        solvedCount: { gte: sheet.minSolvedCount },
      },
    });

    return {
      ...sheet,
      problemCount,
    };
  }

  public async getById(id: string): Promise<LevelSheet> {
    const sheet = await this.db.levelSheet.findUnique({
      where: { id },
    });
    if (!sheet) {
      throw new AppError('NOT_FOUND', `Level sheet not found`);
    }
    return sheet;
  }

  public async createSheet(input: CreateSheetInput): Promise<LevelSheetDto> {
    const existing = await this.db.levelSheet.findUnique({
      where: { slug: input.slug },
    });
    if (existing) {
      throw new AppError('CONFLICT', `Sheet with slug "${input.slug}" already exists`);
    }

    const created = await this.db.levelSheet.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description,
        minRating: input.minRating,
        maxRating: input.maxRating,
        includeTags: input.includeTags,
        excludeTags: input.excludeTags,
        minSolvedCount: input.minSolvedCount,
        questionCount: input.questionCount,
        sortOrder: input.sortOrder,
        isActive: true,
      },
    });

    return {
      ...created,
      problemCount: 0,
    };
  }

  public async updateSheet(id: string, input: UpdateSheetInput): Promise<LevelSheetDto> {
    const existing = await this.db.levelSheet.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', `Level sheet not found`);
    }

    const updated = await this.db.levelSheet.update({
      where: { id },
      data: input,
    });

    const problemCount = await this.db.problem.count({
      where: {
        isActive: true,
        rating: { gte: updated.minRating, lte: updated.maxRating },
        solvedCount: { gte: updated.minSolvedCount },
      },
    });

    return {
      ...updated,
      problemCount,
    };
  }
}
