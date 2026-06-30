import bcrypt from "bcrypt";
import { prisma } from "../db.js";

// Seeds a known test user so there's always a login to develop against.
// Idempotent: re-running just leaves the existing user in place.
// Run with:  npm run seed   (builds first, then executes dist/scripts/seed.js)

const TEST_USER = {
  email: "test@example.com",
  username: "testuser",
  password: "password123", // dev-only; min length is 8
};

async function main() {
  const passwordHash = await bcrypt.hash(TEST_USER.password, 12);
  const user = await prisma.user.upsert({
    where: { username: TEST_USER.username },
    update: {}, // don't clobber an existing password on re-seed
    create: {
      email: TEST_USER.email,
      username: TEST_USER.username,
      passwordHash,
    },
  });
  console.log(
    `[seed] user ready: id=${user.id} username=${user.username}\n` +
      `       log in with  ${TEST_USER.username} / ${TEST_USER.password}`,
  );
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
