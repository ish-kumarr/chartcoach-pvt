$ErrorActionPreference = "Stop"
$workspace = $PSScriptRoot
$localState = Join-Path $workspace ".local"
$envFile = Join-Path $localState "local.env"
$nextBinary = Join-Path $workspace "frontend\node_modules\.bin\next.cmd"
$backendPython = Join-Path $workspace "backend\venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $backendPython)) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        throw "Python is missing. Create backend\venv or install Python before starting ChartCoach."
    }
    $backendPython = $pythonCommand.Source
}

New-Item -ItemType Directory -Force -Path $localState | Out-Null

if (-not (Test-Path -LiteralPath $nextBinary)) {
    throw "Frontend dependencies are missing. Run 'npm ci' from the frontend directory first."
}

if (-not (Test-Path -LiteralPath $envFile)) {
    $mongoPassword = -join ((1..48) | ForEach-Object { "0123456789abcdef"[(Get-Random -Maximum 16)] })
    $jwtSecret = -join ((1..64) | ForEach-Object { "0123456789abcdef"[(Get-Random -Maximum 16)] })
    [IO.File]::WriteAllLines(
        $envFile,
        @(
            "CHARTCOACH_MONGO_USERNAME=chartcoach",
            "CHARTCOACH_MONGO_PASSWORD=$mongoPassword",
            "CHARTCOACH_JWT_SECRET=$jwtSecret"
        )
    )
}

$localEnvironment = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
    if (-not $line -or $line.StartsWith("#")) { continue }
    $key, $value = $line.Split("=", 2)
    $localEnvironment[$key] = $value
}
if (-not $localEnvironment.ContainsKey("LOCAL_MEDIA_WRAPPING_SECRET")) {
    $wrappingSecret = -join ((1..64) | ForEach-Object { "0123456789abcdef"[(Get-Random -Maximum 16)] })
    Add-Content -LiteralPath $envFile -Value "LOCAL_MEDIA_WRAPPING_SECRET=$wrappingSecret"
    $localEnvironment["LOCAL_MEDIA_WRAPPING_SECRET"] = $wrappingSecret
}

docker info --format "{{.ServerVersion}}" | Out-Null
$backendEnvFile = Join-Path $workspace "backend\.env"
$usesConfiguredDatabase = $false
if (Test-Path -LiteralPath $backendEnvFile) {
    $usesConfiguredDatabase = [bool](Get-Content -LiteralPath $backendEnvFile | Where-Object { $_ -match '^DATABASE_URL=.+$' } | Select-Object -First 1)
}
$composeServices = @("simulator-redis", "simulator-mongo")
if (-not $usesConfiguredDatabase) { $composeServices = @("mongo") + $composeServices }
docker compose --env-file $envFile -f (Join-Path $workspace "compose.local.yml") up -d --wait @composeServices

$backendEnvironment = @{
    SIMULATOR_DATABASE_URL = "mongodb://127.0.0.1:27019/?replicaSet=simulator-rs&directConnection=true"
    SIMULATOR_DATABASE_NAME = "chartcoach_simulator"
    JWT_SECRET_KEY = $localEnvironment.CHARTCOACH_JWT_SECRET
    FRONTEND_ORIGIN = "http://localhost:3000"
    COOKIE_SECURE = "false"
    APP_ENVIRONMENT = "development"
    PLAYBACK_PROVIDER = "local"
    DRM_CREDENTIALS_STATUS = "pending"
    LOCAL_MEDIA_WRAPPING_SECRET = $localEnvironment.LOCAL_MEDIA_WRAPPING_SECRET
    MEDIA_ROOT = (Join-Path $workspace ".media")
}
if (-not $usesConfiguredDatabase) {
    $backendEnvironment["DATABASE_URL"] = "mongodb://$($localEnvironment.CHARTCOACH_MONGO_USERNAME):$($localEnvironment.CHARTCOACH_MONGO_PASSWORD)@127.0.0.1:27018/?authSource=admin"
    $backendEnvironment["DATABASE_NAME"] = "chartcoach-local"
}

foreach ($requiredPort in @(3000, 8000)) {
    $listener = Get-NetTCPConnection -LocalPort $requiredPort -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        throw "Port $requiredPort is already in use by process $($listener[0].OwningProcess). Stop the existing local stack first."
    }
}
$backendProcess = Start-Process $backendPython -WorkingDirectory (Join-Path $workspace "backend") `
    -WindowStyle Hidden -PassThru -Environment $backendEnvironment `
    -RedirectStandardOutput (Join-Path $localState "backend.out.log") `
    -RedirectStandardError (Join-Path $localState "backend.err.log") `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"
$frontendProcess = Start-Process npm.cmd -WorkingDirectory (Join-Path $workspace "frontend") `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $localState "frontend.out.log") `
    -RedirectStandardError (Join-Path $localState "frontend.err.log") `
    -ArgumentList "run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3000"
$workerProcess = Start-Process $backendPython -WorkingDirectory (Join-Path $workspace "backend") `
    -WindowStyle Hidden -PassThru -Environment $backendEnvironment `
    -RedirectStandardOutput (Join-Path $localState "worker.out.log") `
    -RedirectStandardError (Join-Path $localState "worker.err.log") `
    -ArgumentList "-m", "app.workers.simulator_worker"
[IO.File]::WriteAllText((Join-Path $localState "backend.pid"), "$($backendProcess.Id)")
[IO.File]::WriteAllText((Join-Path $localState "frontend.pid"), "$($frontendProcess.Id)")
[IO.File]::WriteAllText((Join-Path $localState "worker.pid"), "$($workerProcess.Id)")

$deadline = (Get-Date).AddSeconds(45)
do {
    Start-Sleep -Milliseconds 500
    try {
        $backendReady = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8000/health" -TimeoutSec 2).StatusCode -eq 200
    } catch {
        $backendReady = $false
    }
    try {
        $frontendReady = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:3000/login" -TimeoutSec 2).StatusCode -eq 200
    } catch {
        $frontendReady = $false
    }
} until (($backendReady -and $frontendReady) -or (Get-Date) -ge $deadline)

if (-not ($backendReady -and $frontendReady)) {
    throw "ChartCoach did not become ready. Inspect the .local error logs."
}
$workerProcess.Refresh()
if ($workerProcess.HasExited) {
    throw "The simulator worker exited during startup. Inspect .local\worker.err.log."
}
Write-Host "ChartCoach is starting at http://127.0.0.1:3000"
Write-Host "MongoDB data persists in the chartcoach-local-mongo-data Docker volume."
Write-Host "Logs and generated local credentials live in $localState and are ignored by Git."
