import { PrismaClient } from '../../prisma/generated/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { DATABASE_URL } from '../config/main-config.ts';

// Prisma 7 requires a driver adapter. new PrismaClient() with no adapter errors.
const adapter = new PrismaPg({
  connectionString: DATABASE_URL,
});

export const prismaQuery = new PrismaClient({ adapter });
