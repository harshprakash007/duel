import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/modules/auth/password';
import { signAuthToken, verifyAuthToken } from '../../src/modules/auth/jwt';

describe('Password hashing with argon2id', () => {
  it('hashes and verifies plain text correctly', async () => {
    const password = 'SuperSecretPassword123!';
    const hash = await hashPassword(password);
    expect(hash).toContain('$argon2id$');

    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, 'WrongPassword123!')).toBe(false);
  });
});

describe('JWT signing and verification', () => {
  const secret = 'my-super-secret-jwt-key-minimum-32-chars!!';

  it('signs and verifies valid tokens', () => {
    const payload = { sub: 'user-uuid-123', role: 'USER' as const, email: 'test@example.com' };
    const token = signAuthToken(payload, secret, 3600);
    const decoded = verifyAuthToken(token, secret);

    expect(decoded).toMatchObject(payload);
  });

  it('rejects invalid or tampered tokens', () => {
    const token = signAuthToken(
      { sub: 'user-uuid-123', role: 'USER' as const, email: 'test@example.com' },
      secret,
      3600,
    );
    expect(verifyAuthToken(token, 'different-secret-key-at-least-32-chars!!')).toBeNull();
    expect(verifyAuthToken('invalid.token.here', secret)).toBeNull();
  });
});
