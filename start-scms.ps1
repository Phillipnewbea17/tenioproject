# Starts everything the SeniorCompanion app needs, in one go:
#   1. the Laravel backend on port 8000
#   2. a public HTTPS address for it, so phones reach it over mobile data
#
# Run it from this folder:   .\start-scms.ps1
# Leave the window open while you use the app. Ctrl+C stops both.
#
# TUNNEL MODE
#   quick  (default) Cloudflare quick tunnel. No account needed, but it hands
#          out a NEW address every start, so lib/services/api_client.dart has
#          to be updated and the app rebuilt each time.
#   ngrok  An ngrok dev domain: one address that never changes, so the app is
#          built once and never again. Needs a free ngrok account:
#            ngrok config add-authtoken <token>
#          then pass the domain:  .\start-scms.ps1 -Tunnel ngrok -Domain xxx.ngrok-free.app

param(
    [ValidateSet('quick', 'ngrok')] [string]$Tunnel = 'quick',
    [string]$Domain
)

$ErrorActionPreference = 'Stop'
$backend = Join-Path $PSScriptRoot 'scms-backend'
$php = Join-Path $env:USERPROFILE '.config\herd-lite\bin\php.exe'

if ($Tunnel -eq 'ngrok' -and [string]::IsNullOrWhiteSpace($Domain)) {
    throw 'Pass the dev domain too, e.g. -Tunnel ngrok -Domain xxx.ngrok-free.app'
}

# 1. The backend. Skipped when something already listens on 8000.
$busy = Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue
if ($busy) {
    Write-Host 'Backend already running on port 8000.' -ForegroundColor DarkGray
} else {
    Write-Host 'Starting the backend on port 8000...' -ForegroundColor Cyan
    Start-Process -FilePath $php -ArgumentList 'artisan', 'serve', '--host=0.0.0.0', '--port=8000' `
        -WorkingDirectory $backend -WindowStyle Minimized
    Start-Sleep -Seconds 4
}

# 2. The public address.
if ($Tunnel -eq 'ngrok') {
    Write-Host "Opening https://$Domain ..." -ForegroundColor Cyan
    Write-Host 'This address never changes. Ctrl+C to stop.' -ForegroundColor Green
    & ngrok http 8000 --url $Domain
    return
}

$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if (-not (Test-Path $cloudflared)) { $cloudflared = 'C:\Program Files\cloudflared\cloudflared.exe' }

$out = Join-Path $env:TEMP 'scms-tunnel.log'
Remove-Item $out -ErrorAction SilentlyContinue
Write-Host 'Opening a public address...' -ForegroundColor Cyan

$proc = Start-Process -FilePath $cloudflared `
    -ArgumentList 'tunnel', '--url', 'http://localhost:8000', '--no-autoupdate' `
    -RedirectStandardError $out -NoNewWindow -PassThru

$url = $null
foreach ($i in 1..30) {
    Start-Sleep -Seconds 1
    if (Test-Path $out) {
        $m = Select-String -Path $out -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue
        if ($m) { $url = $m.Matches[0].Value; break }
    }
}

if (-not $url) {
    Write-Host 'The tunnel did not come up. See' $out -ForegroundColor Red
    exit 1
}

$baked = Select-String -Path (Join-Path $PSScriptRoot '..\my_senior_app\lib\services\api_client.dart') `
    -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue

Write-Host ''
Write-Host "  Backend is public at: $url" -ForegroundColor Green
if ($baked -and $baked.Matches[0].Value -ne $url) {
    Write-Host ''
    Write-Host '  THE ADDRESS CHANGED since the app was built.' -ForegroundColor Yellow
    Write-Host '  The app still points at' $baked.Matches[0].Value -ForegroundColor Yellow
    Write-Host '  Put the new one in lib/services/api_client.dart (permanentBaseUrl)' -ForegroundColor Yellow
    Write-Host '  and rebuild, or switch to -Tunnel ngrok to stop doing this.' -ForegroundColor Yellow
}
Write-Host ''
Write-Host '  Codes are shown by:  .\otp.ps1 -Watch' -ForegroundColor DarkGray
Write-Host '  Ctrl+C stops the tunnel.' -ForegroundColor DarkGray
Write-Host ''

try { Wait-Process -Id $proc.Id } finally { Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue }
