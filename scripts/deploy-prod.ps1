param(
  [Parameter(Mandatory = $true)]
  [string]$ServerHost,

  [Parameter(Mandatory = $true)]
  [string]$ServerUser,

  [Parameter(Mandatory = $true)]
  [string]$RemoteDir,

  [int]$ServerPort = 22,
  [string]$AppName = "dashboard",
  [switch]$ReloadNginx
)

$ErrorActionPreference = "Stop"

function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $name"
  }
}

Write-Host "[1/6] Checking required tools..."
Require-Command "npm"
Require-Command "ssh"
Require-Command "scp"
Require-Command "tar"

Write-Host "[2/6] Building production bundle..."
npm ci
npm run build

if (-not (Test-Path "dist")) {
  throw "Build output dist not found."
}

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$archive = "$AppName-$ts.tar.gz"
$remoteArchive = "/tmp/$archive"

Write-Host "[3/6] Packing dist to archive..."
if (Test-Path $archive) {
  Remove-Item $archive -Force
}
tar -czf $archive dist

Write-Host "[4/6] Uploading archive to server..."
scp -P $ServerPort $archive "$ServerUser@$ServerHost`:$remoteArchive"

Write-Host "[5/6] Publishing release on server..."
$remoteScript = @"
set -e
mkdir -p '$RemoteDir/releases' '$RemoteDir/shared'
release_dir='$RemoteDir/releases/$ts'
mkdir -p "\$release_dir"
tar -xzf '$remoteArchive' -C "\$release_dir"
mv "\$release_dir/dist" "\$release_dir/current"
ln -sfn "\$release_dir/current" '$RemoteDir/current'
rm -f '$remoteArchive'
find '$RemoteDir/releases' -maxdepth 1 -mindepth 1 -type d | sort | head -n -5 | xargs -r rm -rf
"@

ssh -p $ServerPort "$ServerUser@$ServerHost" $remoteScript

if ($ReloadNginx.IsPresent) {
  Write-Host "[6/6] Reloading nginx..."
  ssh -p $ServerPort "$ServerUser@$ServerHost" "sudo nginx -t && sudo systemctl reload nginx"
} else {
  Write-Host "[6/6] Skip nginx reload (use -ReloadNginx to enable)."
}

Remove-Item $archive -Force
Write-Host "Done. Current release path: $RemoteDir/current"
