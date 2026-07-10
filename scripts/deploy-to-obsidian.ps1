# LLM CLI Bridge - Deploy main.js + manifest.json + styles.css to all Obsidian vault plugin dirs
# Usage: powershell -ExecutionPolicy Bypass -File scripts\deploy-to-obsidian.ps1
$ErrorActionPreference = "Stop"
$src = (Split-Path $PSScriptRoot)
# 所有已知的 Obsidian vault 插件目录（新增 vault 时在此追加）
$targets = @(
  "D:\Users\Ye_Luo\APP\Obsidian\LLM-Wiki\.obsidian\plugins\llm-cli-bridge",
  "D:\Users\Ye_Luo\APP\Test\Obsidian\LLM-Wiki\.obsidian\plugins\llm-cli-bridge"
)
Write-Host "=== LLM CLI Bridge Deploy ===" -ForegroundColor Cyan
Write-Host "Source: $src"
if (-not (Test-Path "$src\main.js")) { Write-Host "[ERROR] Source main.js not found. Run: node esbuild.config.mjs production" -ForegroundColor Red; exit 1 }
$srcMain = Get-Item "$src\main.js"
$successCount = 0
foreach ($dst in $targets) {
  Write-Host ""
  Write-Host "Target: $dst" -ForegroundColor Yellow
  if (-not (Test-Path $dst)) {
    Write-Host "  [SKIP] Target dir not found" -ForegroundColor DarkYellow
    continue
  }
  robocopy $src $dst main.js manifest.json styles.css /njh /njs /nc /ns /np
  if ($LASTEXITCODE -ge 8) { Write-Host "  [ERROR] robocopy failed: $LASTEXITCODE" -ForegroundColor Red; continue }
  $deployed = Get-Item "$dst\main.js"
  Write-Host "  [OK] Deploy success" -ForegroundColor Green -NoNewline
  Write-Host "  main.js: $($deployed.Length) bytes" -NoNewline
  if ($deployed.Length -eq $srcMain.Length) { Write-Host "  Match: OK" -ForegroundColor Green } else { Write-Host "  Mismatch: check build" -ForegroundColor Red }
  $manifest = Get-Content "$dst\manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
  Write-Host "  manifest version: $($manifest.version)" -ForegroundColor Cyan
  $successCount++
}
Write-Host ""
Write-Host "Deployed to $successCount/$($targets.Count) vaults" -ForegroundColor Cyan
Write-Host "Next: Reload plugin in Obsidian (Settings > Community plugins > disable/enable LLM CLI Bridge)" -ForegroundColor Cyan
