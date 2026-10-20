import { createPrisma } from '../src/db/prisma';
import { loadConfig } from '../src/config/index';
import { loadDotEnv } from '../src/lib/dotenv';
import { seedLevelSheets } from '../src/modules/sheets/seed';
import { hashPassword } from '../src/modules/auth/password';

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const db = createPrisma(config.databaseUrl);

  console.log('Seeding Level Sheets (L1–L6)...');
  await seedLevelSheets(db);

  // Seed default admin account if not present or update password
  const adminEmail = 'admin@duel.local';
  const existingAdmin = await db.user.findUnique({ where: { email: adminEmail } });
  const passwordHash = await hashPassword('AdminPass123!');
  if (!existingAdmin) {
    await db.user.create({
      data: {
        email: adminEmail,
        displayName: 'Administrator',
        passwordHash,
        role: 'ADMIN',
      },
    });
    console.log(`Created default admin: ${adminEmail}`);
  } else {
    await db.user.update({
      where: { email: adminEmail },
      data: { passwordHash, role: 'ADMIN' },
    });
    console.log(`Updated default admin credentials: ${adminEmail}`);
  }

  await db.$disconnect();
  console.log('Seed completed successfully.');
}

main().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
