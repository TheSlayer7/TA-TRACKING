# TA Calculator Backend

## Database

This backend uses PostgreSQL.

If you installed PostgreSQL 18, the command-line tools are usually in:

```powershell
C:\Program Files\PostgreSQL\18\bin
```

You can run `psql`, `createdb`, and `pg_dump` from that folder directly, or add it to PATH for the current shell.

## Schema setup

The easiest way is to run the bootstrap script, which creates the database if needed, applies the schema, and seeds demo users:

```powershell
cd c:\siteimade\internship\backend
npm run db:setup
```

You only need to do this when setting up the project, after deleting the database, or when you want to re-apply the schema. You do not need to open PostgreSQL tools every time you start the backend.

The Windows bootstrap prompts once for the PostgreSQL password and writes it into `backend/.env` so later backend starts can reuse it.

If you want to do it manually, run the SQL script in `backend/sql/schema.sql` against your PostgreSQL database.

If your database user does not own the `public` schema, run the setup or migration with a privileged PostgreSQL account. The RBAC migration creates new tables, roles, and permissions and needs schema create privileges.

Example with `psql`:

```powershell
psql -U your_user -d your_database -f c:\siteimade\internship\backend\sql\schema.sql
```

If `psql` is not on PATH, use the full executable path:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U your_user -d your_database -f c:\siteimade\internship\backend\sql\schema.sql
```

## Environment variables

Create a `.env` file in `backend/` with:

```env
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=ta_calculator
JWT_SECRET=replace_with_a_long_random_secret
```

## Run

```powershell
cd c:\siteimade\internship\backend
npm install
npm run dev
```

## Seeding demo users

If you created the schema manually, run the Node seeding script which will store bcrypt-hashed passwords:

```powershell
cd c:\siteimade\internship\backend
npm install
npm run seed
```

By default the script uses the password `Password123!` for all demo accounts. You can override it by setting the `SEED_PASSWORD` environment variable before running the script.

If you prefer PostgreSQL tools, create the database first with:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres ta_calculator
```

If you are upgrading an existing database, run:

```powershell
cd c:\siteimade\internship\backend
npm run migrate:rbac
```

## Auth flow

- `POST /api/auth/login` returns a JWT token.
- If an account has two-factor authentication enabled, login returns a temporary challenge and the frontend must call `POST /api/auth/verify-2fa` with the one-time code.
- The token payload contains `id`, `name`, `email`, `pay_level`, and `role`.
- `verifyToken` checks the token.
- `requireRole('Accounts')` protects the pending-claims and verification routes.

## Two-factor authentication

- `GET /api/auth/2fa/setup` creates a fresh TOTP secret and QR code for the signed-in user.
- `POST /api/auth/2fa/enable` confirms the code from the authenticator app and saves the secret.
- `POST /api/auth/2fa/disable` turns 2FA off after password confirmation.
- The frontend includes a security page for enabling and disabling 2FA.

## Seed users

Use these demo accounts after loading the schema:

- `employee@siteimade.local` / `Password123!`
- `accounts@siteimade.local` / `Password123!`
- `admin@siteimade.local` / `Password123!`

The demo accounts start with 2FA disabled so you can sign in normally and then enable it from the security page.
