$ErrorActionPreference = "Stop"
$workspace = $PSScriptRoot
$localState = Join-Path $workspace ".local"

function Stop-ProcessTree([int]$RootProcessId) {
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $RootProcessId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
        Stop-ProcessTree -RootProcessId $child.ProcessId
    }
    Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
}

foreach ($name in @("frontend", "backend", "worker")) {
    $pidFile = Join-Path $localState "$name.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) {
        continue
    }

    $processId = [int](Get-Content -LiteralPath $pidFile -Raw)
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
        Stop-ProcessTree -RootProcessId $processId
    }
    Remove-Item -LiteralPath $pidFile -Force
}

$envFile = Join-Path $localState "local.env"
if (Test-Path -LiteralPath $envFile) {
    docker compose --env-file $envFile -f (Join-Path $workspace "compose.local.yml") stop
}

Write-Host "ChartCoach local services stopped. MongoDB data was preserved."
