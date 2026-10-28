# INTRIGUE V12: pre-commit check. Never prints secret values.
$ErrorActionPreference = 'Stop'
$project = Join-Path $HOME 'Projects\intrigue-operations-ai'
Set-Location $project
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is not installed.' }
$gitList = & git ls-files --cached
if ($LASTEXITCODE -ne 0) { throw 'Not a Git repository. Initialize Git first.' }
$unsafe = @($gitList | Where-Object {
  $_ -match '(^|[/\\])\.env([^/\\]*)?$' -and $_ -notmatch '(^|[/\\])\.env\.example$' -or
  $_ -match '(?i)(\.backup|\.bak|\.v[0-9]+-backup|\.before-model-fix)' -or
  $_ -match '(^|[/\\])(\.next|node_modules)/'
})
if ($unsafe.Count -gt 0) {
  Write-Host ('BLOCKED: tracked secret/backup/build files: ' + ($unsafe -join ', ')) -ForegroundColor Red
  throw 'Untrack these paths with git rm --cached before pushing. Do not delete local secrets.'
}
$hits = @()
foreach ($file in $gitList) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
  $extension = [IO.Path]::GetExtension($file).ToLowerInvariant()
  if ($extension -notin @('.ts','.tsx','.js','.mjs','.json','.md','.yaml','.yml','.sql','.ps1','.txt','.css','.html','.example','.gitignore')) { continue }
  $raw = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $file).Path)
  if ($raw -match 'sb_secret_[A-Za-z0-9_-]{15,}' -or
      $raw -match 'sk-or-v1-[A-Za-z0-9]{15,}' -or
      $raw -match '(?i)SUPABASE_SERVICE_ROLE_KEY\s*=\s*eyJ[A-Za-z0-9_-]{20,}') {
    $hits += $file
  }
}
if ($hits.Count -gt 0) {
  Write-Host ('BLOCKED: possible credentials in tracked files: ' + ($hits -join ', ')) -ForegroundColor Red
  throw 'Remove the secrets from history and rotate affected keys before publishing.'
}
$ignored = & git check-ignore '.env.local' '.env.local.backup' '.env.production' 2>$null
if ((@($ignored)).Count -lt 3) {
  throw 'Git is not ignoring all the expected environment filenames. Check .gitignore.'
}
Write-Host 'PASS: no tracked environment/backup files or obvious credentials detected.' -ForegroundColor Green
Write-Host 'NOTE: this is a basic preflight, not a full secrets audit. Keep the repository PRIVATE.' -ForegroundColor Yellow
