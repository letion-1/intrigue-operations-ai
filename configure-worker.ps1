# Configure the local worker's secret, without displaying it in console output.
# Run FROM THE PROJECT DIRECTORY after installing V11.
$ErrorActionPreference='Stop'
$envFile=Join-Path $HOME 'Projects\intrigue-operations-ai\.env.local'
if (-not (Test-Path $envFile)) { throw '.env.local not found in INTRIGUE project.' }
Write-Host 'Paste the Supabase SECRET key from your own Ai_automation project. Do not share it in chat.' -ForegroundColor Yellow
$keySecure=Read-Host 'Supabase secret key (hidden)' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($keySecure)
try { $key=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
if (-not ($key.StartsWith('sb_secret_') -or $key.StartsWith('eyJ'))) {
  throw 'This does not look like a Supabase secret or legacy service_role key. No file changed.'
}
$lines = @([IO.File]::ReadAllLines($envFile) | Where-Object { $_ -notmatch '^\s*(SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)\s*=' })
$lines += "SUPABASE_SECRET_KEY=$key"
$utf8=[System.Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllLines($envFile, [string[]]$lines, $utf8)
$key=$null
Write-Host 'Secret stored in local .env.local. Never commit this file to Git.' -ForegroundColor Green
