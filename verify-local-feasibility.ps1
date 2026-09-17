param(
    [switch]$SkipFrontend,
    [switch]$SkipLive,
    [switch]$IncludePersistence
)

$ErrorActionPreference = "Stop"

$workspace = $PSScriptRoot
$backend = Join-Path $workspace "backend"
$frontend = Join-Path $workspace "frontend"
$localEnvFile = Join-Path $workspace ".local\local.env"
$previousDatabaseUrl = $env:DATABASE_URL
$previousDatabaseName = $env:DATABASE_NAME
$previousJwtSecret = $env:JWT_SECRET_KEY
$previousMongoTestUrl = $env:LOCAL_MONGODB_TEST_URL

function Invoke-Checked {
    param(
        [string]$Label,
        [scriptblock]$Command
    )

    Write-Host "`n==> $Label"
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

try {
    $env:DATABASE_URL = "mongomock://local"
    $env:DATABASE_NAME = "chartcoach-test"
    $env:JWT_SECRET_KEY = "local-feasibility-test-secret"

    Invoke-Checked "Backend automated checks" {
        Push-Location $backend
        try {
            python -m pytest tests -q
        } finally {
            Pop-Location
        }
    }

    if (-not $SkipFrontend) {
        Invoke-Checked "Frontend automated checks" {
            Push-Location $frontend
            try {
                npm test -- --run
            } finally {
                Pop-Location
            }
        }
        Invoke-Checked "Frontend production build" {
            Push-Location $frontend
            try {
                npm run build
            } finally {
                Pop-Location
            }
        }
    }

    if (-not $SkipLive) {
        Write-Host "`n==> Live service readiness"
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 5
        $drm = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health/drm" -TimeoutSec 5
        if (-not $health) {
            throw "Backend health response was empty"
        }
        if (
            $drm.provider -ne "local" -or
            $drm.mode -ne "development-clear-key" -or
            $drm.playable -ne $true -or
            $drm.credentials_status -ne "pending" -or
            $drm.production_ready -ne $false -or
            $drm.blocking_reasons -notcontains "widevine_credentials_pending" -or
            $drm.blocking_reasons -notcontains "fairplay_credentials_pending"
        ) {
            throw "DRM readiness did not report playable local Clear Key with vendor credentials pending"
        }
        Write-Host "Local Clear Key is playable; credentialed DRM remains explicitly pending."
    }

    if ($IncludePersistence) {
        if (-not (Test-Path -LiteralPath $localEnvFile)) {
            throw ".local/local.env was not found. Start the local stack first."
        }
        $localEnvironment = @{}
        foreach ($line in Get-Content -LiteralPath $localEnvFile) {
            if (-not $line -or $line.StartsWith("#")) { continue }
            $key, $value = $line.Split("=", 2)
            $localEnvironment[$key] = $value
        }
        $env:LOCAL_MONGODB_TEST_URL = "mongodb://$($localEnvironment.CHARTCOACH_MONGO_USERNAME):$($localEnvironment.CHARTCOACH_MONGO_PASSWORD)@127.0.0.1:27018/?authSource=admin"
        Invoke-Checked "MongoDB persistence check" {
            Push-Location $backend
            try {
                python -m pytest tests/integration/test_persistent_mongo.py -q
            } finally {
                Pop-Location
            }
        }
    }

    Write-Host "`nLocal feasibility verification completed."
} finally {
    $env:DATABASE_URL = $previousDatabaseUrl
    $env:DATABASE_NAME = $previousDatabaseName
    $env:JWT_SECRET_KEY = $previousJwtSecret
    $env:LOCAL_MONGODB_TEST_URL = $previousMongoTestUrl
}
