$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$zip = Join-Path $root 'INTRIGUE_AI_MISSING_RUNTIME_REVIEW.zip'
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ('intrigue-missing-sources-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    $paths = @(
      'tools/intrigue-v17/quotation-analysis.mjs',
      'lib/intrigue-vapi-google.ts',
      'lib/intrigue-vapi-calendly.ts',
      'lib/intrigue-vapi-call-history.ts'
    )
    $paths += @(Get-ChildItem (Join-Path $root 'app/api') -Recurse -Filter 'route.ts' -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match 'vapi|receptionist|knowledge|embedding' } |
      ForEach-Object { $_.FullName.Substring($root.Length+1).Replace('\','/') })
    $paths = @($paths | Sort-Object -Unique)
    $included = New-Object System.Collections.Generic.List[string]
    foreach($relative in $paths){
      if ($relative -match '(^|/)(\.env|node_modules|private|secrets)(/|$)' -or $relative -match '\.(json|pem|key)$') { continue }
      $from = Join-Path $root $relative
      if(-not (Test-Path -LiteralPath $from -PathType Leaf)){ continue }
      $content = Get-Content -LiteralPath $from -Raw
      if ($content -match '(?i)(sk-or-v1-[a-z0-9]{20}|sk-proj-[a-z0-9_-]{20}|sb_secret_[a-z0-9]{20})') {
          Write-Warning "Potential secret in $relative. Omitted. Inspect and redact locally."
          continue
      }
      $to = Join-Path $temporary $relative
      New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force | Out-Null
      Copy-Item -LiteralPath $from -Destination $to
      [void]$included.Add($relative)
    }
    if(Test-Path $zip){Remove-Item $zip -Force}
    Compress-Archive -Path (Join-Path $temporary '*') -DestinationPath $zip -CompressionLevel Optimal
    Write-Host "Collected $($included.Count) source files: $zip"
    Write-Host 'Review the archive before sharing. No .env.local or credential files collected.'
} finally {
    Remove-Item $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
