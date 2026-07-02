<#
Secure bootstrap wrapper for Windows PowerShell.

Prompts for the local database user's password (secure input), sets it
temporarily in the `DB_PASSWORD` environment variable, runs `npm install` and
`npm run db:setup`, then clears the environment variable.

Run from the repository root or from the `backend` folder:

  powershell -ExecutionPolicy Bypass -File .\backend\bootstrap.ps1

#>

param(
  [string]$BackendDir = ".",
  [string]$NodeCmd = "C:\Program Files\nodejs\npm.cmd"
)

Write-Host "Database password required for your local PostgreSQL role (input hidden)"
$secure = Read-Host -Prompt 'Database password' -AsSecureString

# Convert SecureString to plain text for this process only
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)

if ([string]::IsNullOrWhiteSpace($plain)) {
  throw "Postgres password is required. Re-run the script and enter the postgres password when prompted."
}

try {
  Write-Host "Using backend directory: $BackendDir"
  # Set env var for the current process only
  $env:DB_PASSWORD = $plain

  Push-Location $BackendDir

  Write-Host "Installing backend dependencies (if needed)..."
  & $NodeCmd install

  Write-Host "Running database bootstrap (db:setup)..."
  & $NodeCmd run db:setup:raw

  $envPath = Join-Path $BackendDir '.env'
  if (Test-Path $envPath) {
    $envContent = Get-Content $envPath -Raw
    if ($envContent -match '(?m)^DB_PASSWORD=.*$') {
      $envContent = $envContent -replace '(?m)^DB_PASSWORD=.*$', "DB_PASSWORD=$plain"
    } else {
      $envContent = $envContent.TrimEnd() + "`r`nDB_PASSWORD=$plain`r`n"
    }
    Set-Content -Path $envPath -Value $envContent -NoNewline
    Write-Host "Saved DB_PASSWORD to $envPath"
  }

  Pop-Location
} finally {
  # Zero out and remove secure memory
  if ($bstr) { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Item Env:DB_PASSWORD -ErrorAction SilentlyContinue
  $plain = $null
}

Write-Host "Done. DB bootstrap attempted - check output above for errors."
