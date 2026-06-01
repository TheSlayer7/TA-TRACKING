# TA Calculator Frontend

This folder now contains a Vite + React app for the TA Calculator backend.

## Run it

1. Start the backend:

```powershell
cd c:\siteimade\internship\backend
npm install
npm run dev
```

2. Start the frontend:

```powershell
cd c:\siteimade\internship\frontend
npm install
npm run dev
```

3. Open the local URL Vite prints, usually:

- `http://localhost:5173`

## What works

- Health check against `/api/health`
- Claim submit to `/api/claims/submit`
- Pending claims loading from `/api/claims/pending`
- Approve/reject actions through `/api/claims/:id/verify`

## Notes

- The frontend proxies `/api` to `http://localhost:5000` in development.
- Paste a JWT token before submitting claims.
- Use a token with the `Accounts` role to load and verify pending claims.
