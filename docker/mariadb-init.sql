-- Runs once, as root, when the MariaDB data volume is first initialized.
-- Grants the dev user (msp) the privileges Prisma needs to create/drop its
-- shadow database during `prisma migrate dev`. Local dev container only — the
-- production konsoleH database uses its own scoped user and `migrate deploy`
-- (which needs no shadow database).
GRANT ALL PRIVILEGES ON *.* TO 'msp'@'%';
FLUSH PRIVILEGES;
