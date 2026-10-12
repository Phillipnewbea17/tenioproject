# Shows the sign-in codes the backend sends.
#
# SMS_DRIVER is not set in scms-backend\.env, so App\Support\Sms falls back to
# the "log" driver: the 4-digit code is written to the Laravel log instead of
# being texted. Until the Android SMS gateway is set up, this is where a code
# is read from.
#
#   .\otp.ps1            the last code sent
#   .\otp.ps1 -Watch     keep running, print each new code as it is sent

param([switch]$Watch)

$log = Join-Path $PSScriptRoot 'scms-backend\storage\logs\laravel.log'

if (-not (Test-Path $log)) {
    Write-Host "No log yet at $log - ask for a code first." -ForegroundColor Yellow
    exit 1
}

function Show-Line($line) {
    if ($line -match '\[SMS to (\+63\d+)\].*code is (\d{4})') {
        $when = if ($line -match '^\[([^\]]+)\]') { $Matches[1] } else { '' }
        Write-Host ''
        Write-Host "  code $($Matches[2])  ->  $($Matches[1])   $when" -ForegroundColor Green
        Write-Host ''
    }
}

if ($Watch) {
    Write-Host 'Watching for codes. Press Ctrl+C to stop.' -ForegroundColor Cyan
    Get-Content $log -Tail 0 -Wait | ForEach-Object { Show-Line $_ }
} else {
    $last = Get-Content $log | Select-String '\[SMS to' | Select-Object -Last 1
    if ($last) { Show-Line $last.Line }
    else { Write-Host 'No code has been sent yet.' -ForegroundColor Yellow }
}
