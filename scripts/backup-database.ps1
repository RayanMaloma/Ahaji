param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\backups')
)

$required = @('PGHOST', 'PGDATABASE', 'PGUSER')
foreach ($name in $required) {
  if (-not [Environment]::GetEnvironmentVariable($name)) {
    throw "$name must be configured outside source control."
  }
}

$pgDump = Get-Command pg_dump -ErrorAction Stop
$psql = Get-Command psql -ErrorAction Stop
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$target = Join-Path $resolvedOutput "ahaji-public-data-$stamp.dump"
if (Test-Path -LiteralPath $target) { throw "Backup already exists: $target" }

# Migrations reconstruct schema. This dump contains application rows only.
# Storage object bytes require a separate export once uploads are introduced.
& $pgDump.Source --format=custom --data-only --schema=public --no-owner --no-acl --file=$target
if ($LASTEXITCODE -ne 0) {
  Remove-Item -LiteralPath $target -ErrorAction SilentlyContinue
  throw "pg_dump failed with exit code $LASTEXITCODE"
}

$digest = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
$countQuery = "select json_build_object('rooms',(select count(*) from public.rooms),'room_hints',(select count(*) from public.room_hints),'room_media',(select count(*) from public.room_media),'game_sessions',(select count(*) from public.game_sessions));"
$countsJson = (& $psql.Source -X -A -t -v ON_ERROR_STOP=1 -c $countQuery) -join ''
if ($LASTEXITCODE -ne 0) { throw 'Backup created, but count verification failed.' }
$manifest = [ordered]@{
  created_at_utc = $stamp
  git_commit = (& git -C (Join-Path $PSScriptRoot '..') rev-parse HEAD).Trim()
  sha256 = $digest
  counts = ($countsJson | ConvertFrom-Json)
}
$manifestPath = "$target.manifest.json"
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-Output "Backup: $target"
Write-Output "Manifest: $manifestPath"
Write-Output "SHA256: $digest"
