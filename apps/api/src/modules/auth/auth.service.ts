import type { Db } from '../../db/prisma';
import type { Config } from '../../config/index';
import { AppError } from '../../lib/errors';
import { hashPassword, verifyPassword } from './password';
import { signAuthToken } from './jwt';
import type { LoginInput, RegisterInput, UserDto } from '@duel/shared';

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {}

  public async register(input: RegisterInput): Promise<{ user: UserDto; token: string }> {
    const emailNorm = input.email.toLowerCase().trim();

    const existing = await this.db.user.findUnique({
      where: { email: emailNorm },
      select: { id: true },
    });

    if (existing) {
      throw new AppError('CONFLICT', 'An account with this email already exists');
    }

    const passwordHash = await hashPassword(input.password);

    const user = await this.db.user.create({
      data: {
        email: emailNorm,
        displayName: input.displayName.trim(),
        passwordHash,
        role: 'USER',
      },
      include: {
        handle: true,
        rating: true,
      },
    });

    const token = signAuthToken(
      { sub: user.id, email: user.email, role: user.role },
      this.config.auth.jwtSecret,
      this.config.auth.jwtExpiresSec,
    );

    return {
      user: this.toDto(user),
      token,
    };
  }

  public async login(input: LoginInput): Promise<{ user: UserDto; token: string }> {
    const emailNorm = input.email.toLowerCase().trim();

    const user = await this.db.user.findUnique({
      where: { email: emailNorm },
      include: {
        handle: true,
        rating: true,
      },
    });

    if (!user || user.deletedAt !== null) {
      throw new AppError('UNAUTHENTICATED', 'Invalid email or password');
    }

    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) {
      throw new AppError('UNAUTHENTICATED', 'Invalid email or password');
    }

    const token = signAuthToken(
      { sub: user.id, email: user.email, role: user.role },
      this.config.auth.jwtSecret,
      this.config.auth.jwtExpiresSec,
    );

    return {
      user: this.toDto(user),
      token,
    };
  }

  public async getMe(userId: string): Promise<UserDto> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: {
        handle: true,
        rating: true,
      },
    });

    if (!user || user.deletedAt !== null) {
      throw new AppError('UNAUTHENTICATED', 'User not found');
    }

    return this.toDto(user);
  }

  private toDto(user: {
    id: string;
    email: string;
    displayName: string;
    role: 'USER' | 'ADMIN';
    createdAt: Date;
    handle: { handle: string; verifiedAt: Date } | null;
    rating: { rating: number } | null;
  }): UserDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      handle: user.handle
        ? {
            handle: user.handle.handle,
            verifiedAt: user.handle.verifiedAt.toISOString(),
            rating: user.rating?.rating ?? null,
          }
        : null,
    };
  }
}
