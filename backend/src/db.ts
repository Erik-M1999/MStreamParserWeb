import { PrismaClient } from "@prisma/client";

// Single Prisma client for the app. Reads DATABASE_URL from the environment.
export const prisma = new PrismaClient();
