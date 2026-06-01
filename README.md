# TA Calculator (Internship project)

Lightweight full-stack project with a Node.js backend and a Vite + React frontend.

**Repository layout**
- `backend/` — Express API, DB scripts, migrations and seeders.
- `frontend/` — Vite + React single-page app.

**Prerequisites**
- Node.js 18+ and `npm` or `yarn` installed.
- (Optional) Python 3.10+ if you plan to use the provided `requirements.txt` for local dev tooling.

Getting started
1. Clone the repo and open the project root.

Backend setup
1. Change to the backend folder and install dependencies:

   npm install

2. Configure environment variables by creating a `.env` file in `backend/` using `.env.example` (if present). Typical variables include DB connection and `JWT_SECRET`.

3. Initialize the database and seed (Windows PowerShell helper included):

   npm run db:setup
   npm run seed

4. Start the backend server (development):

   npm run dev

Frontend setup
1. Change to the frontend folder and install dependencies:

   cd frontend
   npm install

2. Start the dev server:

   npm run dev

3. Build for production:

   npm run build

Useful scripts (from `backend/package.json`)
- `npm run start` — start `src/server.js` with Node
- `npm run dev` — start with `nodemon` for auto-reload
- `npm run seed` — run seed script
- `npm run db:setup` — run database bootstrap PowerShell script
- `npm run migrate:rbac` — run RBAC migration script

Python tooling (optional)
- Install dev/test/formatting tools:

  pip install -r requirements.txt

Security and secrets
- Sensitive files are intentionally ignored via `.gitignore` (keys, `.env`, cloud credentials, Terraform state, SSH keys, etc.). Never commit secrets to the repository.

Contributing
- Open issues or submit pull requests. Keep changes focused and include tests where applicable.

License
- Project license not specified — add a `LICENSE` file if you want to publish this project.
