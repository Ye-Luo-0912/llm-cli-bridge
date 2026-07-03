# LLM CLI Bridge - Deploy main.js + styles.css to Obsidian plugin dir
# Usage: powershell -ExecutionPolicy Bypass -File scripts\deploy-to-obsidian.ps1
$ErrorActionPreference = "Stop"
$src = (Split-Path (Split-Path $PSScriptRoot))
$dst = "D:\Users\Ye_Luo\APP\Obsidian\LLM-Wiki\.obsidian\plugins\llm-cli-bridge"
Write-Host "=== LLM CLI Bridge Deploy ===" -ForegroundColor Cyan
Write-Host "Source: $src"
Write-Host "Target: $dst"
if (-not (Test-Path "$src\main.js")) { Write-Host "[ERROR] Source main.js not found. Run: node esbuild.config.mjs production" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $dst)) { Write-Host "[ERROR] Target dir not found: $dst" -ForegroundColor Red; exit 1 }
Write-Host "Deploying main.js + styles.css ..." -ForegroundColor Yellow
robocopy $src $dst main.js styles.css /njh /njs /nc /ns /np
if ($LASTEXITCODE -ge 8) { Write-Host "[ERROR] robocopy failed: $LASTEXITCODE" -ForegroundColor Red; exit 1 }
$deployed = Get-Item "$dst\main.js"
$srcMain = Get-Item "$src\main.js"
Write-Host ""
Write-Host "[OK] Deploy success" -ForegroundColor Green
Write-Host "  main.js: $($deployed.Length) bytes"
Write-Host "  source:  $($srcMain.Length) bytes"
if ($deployed.Length -eq $srcMain.Length) { Write-Host "  Match: OK" -ForegroundColor Green } else { Write-Host "  Mismatch: check build" -ForegroundColor Red }
Write-Host ""
Write-Host "Next: Reload plugin in Obsidian (Settings > Community plugins > disable/enable LLM CLI Bridge)" -ForegroundColor Cyan
