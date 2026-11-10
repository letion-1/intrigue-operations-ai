# Collect only source code needed to integrate live AI routing. No .env or credentials.
$ErrorActionPreference='Stop'
$root=(Get-Location).Path
$names=@(
 'tools/intrigue-v17/worker.mjs',
 'app/api/agent/route.ts',
 'app/api/assistant/route.ts',
 'app/api/integrations/vapi/webhook/route.ts',
 'app/api/actions/propose/route.ts',
 'lib/semantic-embeddings.ts'
)
$tmp=Join-Path $env:TEMP ('intrigue-runtime-sources-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force|Out-Null
$copied=@()
foreach($p in $names){
  $source=Join-Path $root $p
  if(Test-Path -LiteralPath $source){
    $dest=Join-Path $tmp $p
    New-Item -ItemType Directory -Path (Split-Path $dest) -Force|Out-Null
    Copy-Item -LiteralPath $source -Destination $dest
    $copied+=$p
  }
}
$report="Source files only. No .env.local or credentials included.`r`n"+($copied -join "`r`n")
[IO.File]::WriteAllText((Join-Path $tmp 'COLLECTION_README.txt'),$report)
$out=Join-Path $root 'INTRIGUE_AI_RUNTIME_SOURCE_REVIEW.zip'
if(Test-Path $out){Remove-Item $out -Force}
Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $out -Force
Remove-Item $tmp -Recurse -Force
Write-Host "Collected $($copied.Count) files: $out"
Write-Host 'Review the ZIP before sharing; do not include private keys or customer data.'
