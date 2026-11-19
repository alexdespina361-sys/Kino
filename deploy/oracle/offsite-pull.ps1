param(
  [string]$Remote = "gdrive:Kino backups",
  [int]$KeepDays = 30,
  [int]$StaleDays = 3
)
$ErrorActionPreference = "Stop"
$keys = Join-Path $HOME ".ssh\kino-oracle-relay"
$known = Join-Path $keys "known_hosts"
$box = "ubuntu@" + ((Get-Content $known | Select-Object -First 1) -split '\s+')[0]
$ssh = @("-i", (Join-Path $keys "id_rsa"), "-o", "UserKnownHostsFile=$known", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20")
$log = Join-Path $HOME ".ssh\kino-backup\offsite.log"
$pattern = '^kino-offsite-(\d{4}-\d{2}-\d{2})\.tar\.gz\.gpg$'
function Say([string]$text) { "$(Get-Date -Format s) $text" | Add-Content -Path $log -Encoding utf8 }

try {
  $there = @(ssh @ssh $box "ls -1 /var/backups/kino-offsite" | Where-Object { $_ -match $pattern })
  if ($LASTEXITCODE -ne 0) { throw "could not list the box's locked copies" }
  $have = @(rclone lsf $Remote --files-only 2>$null)
  $temp = Join-Path $env:TEMP "kino-offsite"
  New-Item -ItemType Directory -Force $temp | Out-Null
  foreach ($name in $there) {
    if ($have -contains $name) { continue }
    $file = Join-Path $temp $name
    scp -q @ssh "${box}:/var/backups/kino-offsite/$name" $file
    if ($LASTEXITCODE -ne 0) { throw "could not fetch $name" }
    rclone copyto $file "$Remote/$name"
    $sent = $LASTEXITCODE
    Remove-Item -Force $file
    if ($sent -ne 0) { throw "could not upload $name" }
    Say "uploaded $name"
  }
  rclone delete $Remote --min-age "${KeepDays}d" --include "kino-offsite-*.tar.gz.gpg"
  $newest = @(rclone lsf $Remote --files-only --include "kino-offsite-*.tar.gz.gpg") | Sort-Object | Select-Object -Last 1
  if (-not $newest -or $newest -notmatch $pattern) { throw "no locked copy on Drive" }
  $age = ((Get-Date).ToUniversalTime().Date - [datetime]::ParseExact($Matches[1], "yyyy-MM-dd", $null)).Days
  if ($age -gt $StaleDays) { throw "the newest copy on Drive is $newest, $age days old" }
  Say "ok, newest on Drive: $newest"
} catch {
  Say "FAILED: $($_.Exception.Message)"
  try { msg.exe $env:USERNAME "Kino off-site backup: $($_.Exception.Message). Log: $log" } catch {}
  exit 1
}
