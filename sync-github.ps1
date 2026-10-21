param(
    [string]$CommitMessage = "Update old-tube extension"
)

$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

$ProjectDir = $PSScriptRoot
Set-Location $ProjectDir

# Always enforce GitHub account identity so local Windows username is never used
git config user.name "augustuspoplus"
git config user.email "49472861+augustuspoplus@users.noreply.github.com"

Write-Host "1. Packaging Firefox Store (AMO) ready archive into dist/old-tube.zip..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path "$ProjectDir\dist" -Force | Out-Null
$ZipPath = "$ProjectDir\dist\old-tube.zip"
Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipStream = [System.IO.File]::Open($ZipPath, [System.IO.FileMode]::Create)
$archive = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)

$filesToPackage = @(
    "manifest.json",
    "content.js",
    "styles.css",
    "popup.html",
    "popup.js",
    "icons/icon-16.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
    "icons/logo.svg"
)

foreach ($relPath in $filesToPackage) {
    $fullPath = Join-Path $ProjectDir ($relPath -replace '/', '\')
    if (Test-Path $fullPath) {
        # Ensure forward slashes inside zip for Mozilla AMO compatibility
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $fullPath, $relPath)
    }
}

$archive.Dispose()
$zipStream.Dispose()

Write-Host "2. Staging and committing changes..." -ForegroundColor Cyan
git add -A
$status = git status --porcelain
if ($status) {
    git commit -m $CommitMessage
} else {
    Write-Host "   No new file changes to commit." -ForegroundColor Yellow
}

Write-Host "3. Checking GitHub authentication..." -ForegroundColor Cyan
gh auth status >$null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "   Not logged into GitHub CLI yet. Launching browser login..." -ForegroundColor Yellow
    gh auth login --web -p https -h github.com
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   GitHub login was cancelled or failed." -ForegroundColor Red
        exit 1
    }
}

gh auth setup-git

Write-Host "4. Syncing with GitHub repository..." -ForegroundColor Cyan
$repoCheck = gh repo view augustuspoplus/old-tube 2>&1
if ($LASTEXITCODE -ne 0) {
    git remote remove origin 2>$null
    Write-Host "   Creating fresh GitHub repository 'old-tube' and pushing..." -ForegroundColor Green
    gh repo create old-tube --public --source=. --remote=origin --push
} else {
    Write-Host "   Pushing latest commits to origin/main..." -ForegroundColor Green
    git push -u origin main
}

Write-Host "`nDone! Your old-tube extension is packaged and live on GitHub." -ForegroundColor Green
