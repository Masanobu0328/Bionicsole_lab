# MasaCAD dev pre-flight health check ("kenshin")
# Run before starting the dev servers to catch the common recurring problems:
#   1. Port conflicts / orphaned (zombie) listeners on 8000 / 3000
#   2. Backend port config drift (stray 8001 / 8010 references)
#   3. Missing required environment keys
#   4. Supabase project auto-paused (INACTIVE) -> "Failed to fetch"
#
# Usage: right-click > Run with PowerShell, or:  powershell -ExecutionPolicy Bypass -File healthcheck.ps1

$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$warnings = 0
$fails = 0

function Write-Section($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [WARN] $m" -ForegroundColor Yellow; $script:warnings++ }
function Fail($m) { Write-Host "  [FAIL] $m" -ForegroundColor Red; $script:fails++ }

Write-Host "MasaCAD dev health check" -ForegroundColor White
Write-Host "root: $root"

# --- 1. Port status ---------------------------------------------------------
Write-Section "Ports (8000 backend / 3000 frontend)"
foreach ($port in 8000, 3000) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        Ok "port $port is free"
        continue
    }
    $procIds = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    $alive = @(); $phantom = @()
    foreach ($procId in $procIds) {
        if (Get-Process -Id $procId -ErrorAction SilentlyContinue) { $alive += $procId } else { $phantom += $procId }
    }
    if ($phantom.Count -gt 0) {
        Warn "port $port held by phantom PID(s): $($phantom -join ', ') (unkillable - restart 'winnat' service or reboot to clear)"
    }
    if ($alive.Count -gt 0) {
        Warn "port $port in use by running PID(s): $($alive -join ', ') (run stop.vbs to free)"
    }
}

# --- 2. Config drift (stray 8001 / 8010) ------------------------------------
Write-Section "Backend port config drift (expect only 8000)"
$scan = Get-ChildItem -Path $root -Recurse -Include *.ts,*.tsx,*.py,*.json,*.vbs,*.md -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch "\\(node_modules|\.next|\.venv|\.git|plans)\\" }
$drift = $scan | Select-String -Pattern "localhost:8001|localhost:8010|--port.,?.80(01|10)|:80(01|10)/api" -ErrorAction SilentlyContinue
if ($drift) {
    foreach ($d in $drift) { Warn "stray port ref: $($d.Path):$($d.LineNumber)" }
} else {
    Ok "no 8001 / 8010 backend references found"
}

# --- 3. Env keys ------------------------------------------------------------
Write-Section "Environment files"
$envChecks = @(
    @{ Path = "frontend\.env.local"; Keys = @("NEXT_PUBLIC_API_BASE_URL","NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY") },
    @{ Path = "backend\.env";        Keys = @("SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY") }
)
foreach ($e in $envChecks) {
    $full = Join-Path $root $e.Path
    if (-not (Test-Path $full)) { Fail "$($e.Path) is missing (copy from .env.example)"; continue }
    $content = Get-Content $full -Raw
    $missing = $e.Keys | Where-Object { $content -notmatch "(?m)^\s*$_\s*=\s*\S" }
    if ($missing) { Fail "$($e.Path) missing keys: $($missing -join ', ')" } else { Ok "$($e.Path) has all required keys" }
}

# --- 4. Supabase health -----------------------------------------------------
Write-Section "Supabase project status"
$envLocal = Join-Path $root "frontend\.env.local"
$supaUrl = $null
if (Test-Path $envLocal) {
    $line = (Get-Content $envLocal | Where-Object { $_ -match "^\s*NEXT_PUBLIC_SUPABASE_URL\s*=" }) | Select-Object -First 1
    if ($line) { $supaUrl = ($line -split "=", 2)[1].Trim() }
}
if (-not $supaUrl) {
    Warn "could not read NEXT_PUBLIC_SUPABASE_URL; skipping Supabase check"
} else {
    try {
        $resp = Invoke-WebRequest -Uri "$supaUrl/auth/v1/health" -Method Get -TimeoutSec 10 -UseBasicParsing
        Ok "Supabase reachable (HTTP $($resp.StatusCode)) - project is active"
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code) {
            Ok "Supabase reachable (HTTP $code) - project is active"
        } else {
            Warn "Supabase unreachable ($supaUrl). Likely auto-paused (INACTIVE) -> restore it in the Supabase dashboard. This is the usual cause of 'Failed to fetch'."
        }
    }
}

# --- Summary ----------------------------------------------------------------
Write-Host ""
if ($fails -gt 0)       { Write-Host "RESULT: $fails failure(s), $warnings warning(s). Fix failures before starting." -ForegroundColor Red }
elseif ($warnings -gt 0) { Write-Host "RESULT: $warnings warning(s). Review above, then start.vbs." -ForegroundColor Yellow }
else                     { Write-Host "RESULT: all clear. Safe to run start.vbs." -ForegroundColor Green }
Write-Host ""
