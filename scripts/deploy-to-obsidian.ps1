# LLM CLI Bridge - Build + Test + Deploy + SHA-256 verify pipeline
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-to-obsidian.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-to-obsidian.ps1 -SkipBuild
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-to-obsidian.ps1 -SkipTests
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-to-obsidian.ps1 -VaultPaths "C:\vault1\.obsidian\plugins\llm-cli-bridge","C:\vault2\.obsidian\plugins\llm-cli-bridge"
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-to-obsidian.ps1 -Reload
param(
  [switch]$SkipBuild,
  [switch]$SkipTests,
  [string[]]$VaultPaths,
  [switch]$Reload
)

$ErrorActionPreference = "Stop"
$src = (Split-Path $PSScriptRoot)

# Default vault targets (can be overridden by -VaultPaths)
if ($VaultPaths -and $VaultPaths.Count -gt 0) {
  $targets = $VaultPaths
} else {
  $targets = @(
    "D:\Users\Ye_Luo\APP\Obsidian\LLM-Wiki\.obsidian\plugins\llm-cli-bridge",
    "D:\Users\Ye_Luo\APP\Test\Obsidian\LLM-Wiki\.obsidian\plugins\llm-cli-bridge"
  )
}

function Write-Step($msg) { Write-Host "[STEP] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "  [ERROR] $msg" -ForegroundColor Red }
function Write-Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }

function Get-FileSHA256($path) {
  return (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLower()
}

# ============================================================
# Phase 1: Build
# ============================================================
if (-not $SkipBuild) {
  Write-Step "Build (tsc + styles + esbuild production)"
  Push-Location $src
  cmd /c "npm run build > $env:TEMP\llm-bridge-build.out 2> $env:TEMP\llm-bridge-build.err"
  $buildExit = $LASTEXITCODE
  Pop-Location
  if ($buildExit -ne 0) {
    Write-Err "Build failed (exit $buildExit)"
    Get-Content "$env:TEMP\llm-bridge-build.err" | Select-Object -Last 10 | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    exit 1
  }
  Write-Ok "Build passed"
} else {
  Write-Warn "Skipping build (-SkipBuild)"
}

# Verify source artifacts exist
foreach ($artifact in @("main.js", "manifest.json", "styles.css")) {
  if (-not (Test-Path "$src\$artifact")) {
    Write-Err "Source $artifact not found. Run: npm run build"
    exit 1
  }
}

# ============================================================
# Phase 2: Tests
# ============================================================
if (-not $SkipTests) {
  Write-Step "Tests (unit + process + presentation)"
  Push-Location $src
  cmd /c "node scripts/run-tests.mjs all > $env:TEMP\llm-bridge-test.out 2> $env:TEMP\llm-bridge-test.err"
  $testExit = $LASTEXITCODE
  Pop-Location
  if ($testExit -ne 0) {
    Write-Err "Tests failed (exit $testExit)"
    Get-Content "$env:TEMP\llm-bridge-test.out" | Select-Object -Last 5 | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    exit 1
  }
  $testSummary = (Get-Content "$env:TEMP\llm-bridge-test.out" | Select-Object -Last 5 | Where-Object { $_ -match "结果|passed|failed" }) -join " "
  Write-Ok "Tests passed: $testSummary"
} else {
  Write-Warn "Skipping tests (-SkipTests)"
}

# ============================================================
# Phase 3: Compute source SHA-256
# ============================================================
Write-Step "Compute source SHA-256"
$srcHashes = @{}
foreach ($artifact in @("main.js", "manifest.json", "styles.css")) {
  $hash = Get-FileSHA256 "$src\$artifact"
  $srcHashes[$artifact] = $hash
  Write-Host "  $artifact : $hash"
}

# ============================================================
# Phase 4: Deploy to vaults
# ============================================================
Write-Step "Deploy to $($targets.Count) vault(s)"
$successCount = 0
$failedTargets = @()

foreach ($dst in $targets) {
  Write-Host ""
  Write-Host "  Target: $dst" -ForegroundColor Yellow
  if (-not (Test-Path $dst)) {
    Write-Warn "Target dir not found, skipping"
    continue
  }

  # Robocopy
  robocopy $src $dst main.js manifest.json styles.css /njh /njs /nc /ns /np 2>&1 | Out-Null
  if ($LASTEXITCODE -ge 8) {
    Write-Err "robocopy failed: $LASTEXITCODE"
    $failedTargets += $dst
    continue
  }

  # SHA-256 verification
  $allMatch = $true
  foreach ($artifact in @("main.js", "manifest.json", "styles.css")) {
    $dstHash = Get-FileSHA256 "$dst\$artifact"
    if ($dstHash -ne $srcHashes[$artifact]) {
      Write-Err "$artifact SHA-256 mismatch: src=$($srcHashes[$artifact]) dst=$dstHash"
      $allMatch = $false
    }
  }

  if ($allMatch) {
    $deployed = Get-Item "$dst\main.js"
    $manifest = Get-Content "$dst\manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Ok "Deploy success — main.js: $($deployed.Length) bytes, version: $($manifest.version)"
    Write-Host "  SHA-256: $($srcHashes['main.js'].Substring(0,16))..." -ForegroundColor DarkGray
    $successCount++
  } else {
    Write-Err "SHA-256 verification failed"
    $failedTargets += $dst
  }
}

# ============================================================
# Phase 5: Summary + optional reload
# ============================================================
Write-Host ""
Write-Host "=== Deploy Summary ===" -ForegroundColor Cyan
Write-Host "  Deployed: $successCount/$($targets.Count) vaults"
if ($failedTargets.Count -gt 0) {
  Write-Host "  Failed:   $($failedTargets.Count)" -ForegroundColor Red
  foreach ($t in $failedTargets) { Write-Host "    - $t" -ForegroundColor Red }
}

if ($Reload -and $successCount -gt 0) {
  Write-Step "Auto-reload plugin via Chrome DevTools Protocol (CDP)"
  # Phase 5: 旧的 HTTP API reload（/api/reload-plugin）路由不存在且端口硬编码 42167 不匹配实际随机端口。
  # 改用 CDP reload：通过 Obsidian 的 --remote-debugging-port=9223 禁用并重新启用插件。
  # 前置条件：Obsidian 必须以 --remote-debugging-port=9223 启动。
  $cdpScript = Join-Path $PSScriptRoot "cdp-reload.mjs"
  $reloadOk = $false
  if (Test-Path $cdpScript) {
    try {
      $nodeResult = & node $cdpScript 2>&1
      $nodeExitCode = $LASTEXITCODE
      if ($nodeExitCode -eq 0) {
        Write-Ok "Reload triggered via CDP"
        $reloadOk = $true
      } else {
        Write-Warn "CDP reload exited with code $nodeExitCode"
        Write-Host "  Output: $nodeResult" -ForegroundColor DarkGray
      }
    } catch {
      Write-Warn "Failed to execute CDP reload script: $($_.Exception.Message)"
    }
  } else {
    Write-Warn "CDP reload script not found: $cdpScript"
  }
  if (-not $reloadOk) {
    Write-Host "  Manual reload required: Settings > Community plugins > disable/enable LLM CLI Bridge" -ForegroundColor Yellow
    Write-Host "  Or start Obsidian with --remote-debugging-port=9223 and re-run with -Reload" -ForegroundColor DarkGray
  }
} elseif ($successCount -gt 0) {
  Write-Host "  Next: Reload plugin in Obsidian (Settings > Community plugins > disable/enable LLM CLI Bridge)" -ForegroundColor Cyan
  Write-Host "  Or re-run with -Reload to attempt auto-reload via CDP (requires Obsidian --remote-debugging-port=9223)" -ForegroundColor DarkGray
}

# Exit non-zero if any target failed
if ($failedTargets.Count -gt 0 -or $successCount -eq 0) {
  exit 1
}

Write-Ok "Pipeline complete"
exit 0
