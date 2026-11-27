# Pick up the newest Tripo Studio export from Downloads (Studio saves it as <uuid>.tmp), check it is a GLB, file it
# as assets/models/<Set>/src/<Id>.glb and write the optimized game copy assets/models/<Set>/<Id>.glb.
#   powershell -File tools/collect-export.ps1 -Id S05 [-Set thornwater] [-Max 1024] [-Since 120]
param([Parameter(Mandatory)][string]$Id, [string]$Set = 'thornwater', [int]$Max = 1024, [int]$Since = 180, [int]$Wait = 60)
$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$root = Split-Path $PSScriptRoot -Parent
$dl = Join-Path $env:USERPROFILE 'Downloads'
$deadline = (Get-Date).AddSeconds($Wait)
do {
  $f = Get-ChildItem $dl -File | Where-Object { ($_.Extension -in '.tmp', '.glb') -and $_.LastWriteTime -gt (Get-Date).AddSeconds(-$Since) -and $_.Length -gt 10000 } |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($f) { Start-Sleep -Milliseconds 800; $len = (Get-Item $f.FullName).Length; Start-Sleep -Milliseconds 800; if ((Get-Item $f.FullName).Length -ne $len) { $f = $null } }
  if (-not $f) { Start-Sleep -Seconds 2 }
} until ($f -or (Get-Date) -gt $deadline)
if (-not $f) { Write-Output "no export found for $Id"; exit 3 }
$head = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($f.FullName)[0..3])
if ($head -ne 'glTF') { Write-Output "$($f.Name) is not a GLB ($head)"; exit 4 }
$srcDir = Join-Path $root "assets\models\$Set\src"
if (-not (Test-Path $srcDir)) { New-Item -ItemType Directory -Force $srcDir | Out-Null }
$src = Join-Path $srcDir "$Id.glb"
Move-Item $f.FullName $src -Force
Set-Location $root
node tools/glb-optimize.mjs "assets/models/$Set/src/$Id.glb" "assets/models/$Set/$Id.glb" --max $Max
