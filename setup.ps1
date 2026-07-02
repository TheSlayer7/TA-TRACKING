<#
One-command local setup helper for the TA Calculator project.

What it does:
- Ensures backend/.env exists by copying backend/.env.example if needed.
- Prompts for the local database password.
- Generates a strong JWT secret if one is missing.
- Installs backend dependencies.
- Runs the database bootstrap.

This script does not create PostgreSQL roles or databases. That part still
needs to be done once in pgAdmin or with a superuser account.
#>

param(
  [string]$RootDir = ".",
  [string]$NodeCmd = "C:\Program Files\nodejs\npm.cmd"
)

$root = (Resolve-Path $RootDir).Path
$backendDir = Join-Path $root 'backend'
$envPath = Join-Path $backendDir '.env'
$envExamplePath = Join-Path $backendDir '.env.example'

if (-not (Test-Path $envPath)) {
  if (-not (Test-Path $envExamplePath)) {
    throw "Missing backend/.env and backend/.env.example. Restore the template first."
  }

  Copy-Item $envExamplePath $envPath
  Write-Host "Created backend/.env from backend/.env.example"
}

$envContent = Get-Content $envPath -Raw

if ($envContent -notmatch '(?m)^DB_PASSWORD=.+$') {
  throw "backend/.env must contain DB_PASSWORD before running setup."
}

if ($envContent -match '(?m)^JWT_SECRET=\s*$') {
  $randomBytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($randomBytes)
  $generatedSecret = [Convert]::ToBase64String($randomBytes)
  $envContent = $envContent -replace '(?m)^JWT_SECRET=\s*$', "JWT_SECRET=$generatedSecret"
  Set-Content -Path $envPath -Value $envContent -NoNewline
  Write-Host 'Generated a local JWT secret in backend/.env'
}

Write-Host 'Install backend dependencies and bootstrap the database with backend/bootstrap.ps1.'
Push-Location $root
try {
  & powershell -ExecutionPolicy Bypass -File .\backend\bootstrap.ps1 -BackendDir $backendDir -NodeCmd $NodeCmd
} finally {
  Pop-Location
}