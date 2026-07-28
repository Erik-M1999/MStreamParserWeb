import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { prisma } from "../db.js";

// Seeds a known test user so there's always a login to develop against.
// Idempotent: re-running just leaves the existing user in place.
// Run with:  npm run seed   (builds first, then executes dist/scripts/seed.js)
//
// The password is NOT hardcoded: set SEED_USER_PASSWORD to choose one, else a
// random one is generated and printed once. That way a seeded database can
// never be opened with a password that is public in this repo.

const TEST_USER = {
  email: "test@example.com",
  username: "testuser",
  password:
    process.env.SEED_USER_PASSWORD || crypto.randomBytes(12).toString("base64url"),
};

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed a test user in production. Unset NODE_ENV to seed a dev database.",
    );
  }
  const existing = await prisma.user.findUnique({
    where: { username: TEST_USER.username },
  });

  if (existing) {
    // Re-seeding never clobbers the password, so printing the one we just
    // generated would be a lie — the old one is still the valid credential.
    console.log(
      `[seed] user already exists: id=${existing.id} username=${existing.username}\n` +
        `       password unchanged. To reset it, delete the user and re-run,\n` +
        `       optionally with SEED_USER_PASSWORD=<your-password>.`,
    );
    return;
  }

  const passwordHash = await bcrypt.hash(TEST_USER.password, 12);
  const user = await prisma.user.create({
    data: {
      email: TEST_USER.email,
      username: TEST_USER.username,
      passwordHash,
    },
  });
  console.log(
    `[seed] user created: id=${user.id} username=${user.username}\n` +
      `       log in with  ${TEST_USER.username} / ${TEST_USER.password}\n` +
      `       (shown once — it is not stored anywhere in plaintext)`,
  );
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
