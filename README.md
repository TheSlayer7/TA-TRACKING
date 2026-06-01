<div align="center">

# TA Calculator

<p><strong>Travel allowance claims, RBAC, and two-factor login in one internship project.</strong></p>

<p>
  <img src="https://img.shields.io/badge/Backend-Node.js%20%2B%20Express-2d6cdf?style=for-the-badge" alt="Backend Node.js + Express badge" />
  <img src="https://img.shields.io/badge/Frontend-Vite%20%2B%20React-00b894?style=for-the-badge" alt="Frontend Vite + React badge" />
  <img src="https://img.shields.io/badge/Database-PostgreSQL-336791?style=for-the-badge" alt="Database PostgreSQL badge" />
</p>

</div>

## Overview

TA Calculator is a full-stack travel allowance claim system with a Node.js API, a Vite + React frontend, PostgreSQL persistence, role-based access control, and optional two-factor authentication.

## Screenshots

| Login | Admin dashboard |
| --- | --- |
| ![Login screen](assets/screenshots/login-page.png) | ![Admin dashboard](assets/screenshots/admin-dashboard.png) |

These screenshots were captured from the running local project.

## Architecture

```mermaid
flowchart LR
   U[User] --> F[Frontend\nVite + React]
   F -->|HTTP /api| B[Backend\nExpress API]
   B --> A[Auth routes\nJWT + 2FA]
   B --> C[Claims routes\nSubmit / review / verify]
   B --> R[RBAC routes\nAdmin / Faculty / TA]
   B --> D[(PostgreSQL)]
   A --> D
   C --> D
   R --> D
```

## What is included

- Claim submission and approval flows.
- JWT-based authentication.
- RBAC for Admin, Faculty, and TA-style user roles.
- TOTP-based two-factor authentication setup and verification.
- PostgreSQL schema, migrations, and seed scripts.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `backend/` | Express API, database bootstrap, migrations, and seed scripts. |
| `frontend/` | Vite + React single-page app. |
| `requirements.txt` | Optional Python tooling for local development. |

## Requirements

- Node.js 18 or newer.
- `npm`.
- PostgreSQL 18 or compatible.
- Optional: Python 3.10+ if you want the helper tooling in `requirements.txt`.

## Quick Start

1. Open the repository root in your editor.
2. Set up the backend database and environment.
3. Start the backend API.
4. Start the frontend app in a second terminal.

## Backend Setup

1. Install backend dependencies.

   ```powershell
   cd backend
   npm install
   ```

2. Create `backend/.env` with your database credentials and JWT secret. A typical setup looks like this:

   ```env
   PORT=5000
   DB_HOST=localhost
   DB_PORT=5432
   DB_USER=postgres
   DB_PASSWORD=your_password
   DB_NAME=ta_calculator
   JWT_SECRET=replace_with_a_long_random_secret
   ```

3. Initialize the database and seed the demo data.

   ```powershell
   npm run db:setup
   npm run seed
   ```

4. Start the backend in development mode.

   ```powershell
   npm run dev
   ```

## Frontend Setup

1. Install frontend dependencies.

   ```powershell
   cd frontend
   npm install
   ```

2. Start the frontend dev server.

   ```powershell
   npm run dev
   ```

3. Build the frontend for production.

   ```powershell
   npm run build
   ```

## Useful Scripts

### Backend

- `npm run start` starts the API with Node.
- `npm run dev` starts the API with `nodemon`.
- `npm run seed` loads demo users and sample data.
- `npm run db:setup` runs the Windows PostgreSQL bootstrap helper.
- `npm run db:setup:raw` runs the raw Node bootstrap script.
- `npm run migrate:rbac` applies the RBAC migration.

### Frontend

- `npm run dev` starts the Vite development server.
- `npm run build` creates a production build.
- `npm run preview` previews the production build locally.

## Project Highlights

- The backend exposes auth, claims, and RBAC routes under `/api`.
- The frontend supports login, dashboard, claims, review, and security flows.
- Demo accounts are included for local testing after seeding the database.
- The backend bootstrap script is intended for first-time setup or schema refreshes, not every startup.

## Demo Accounts

After seeding, you can sign in with these example users:

- `employee@siteimade.local` / `Password123!`
- `accounts@siteimade.local` / `Password123!`
- `admin@siteimade.local` / `Password123!`

## Security Notes

- Keep `.env` files, keys, and other secrets out of version control.
- Use a strong `JWT_SECRET` value in local and deployed environments.
- Enable two-factor authentication for accounts that need additional protection.

## Optional Python Tooling

If you want the local Python helper tools, install them from the repository root:

```powershell
pip install -r requirements.txt
```

## Contributing

Keep changes focused, test the relevant flows, and document any new setup requirements in this README.

## License

