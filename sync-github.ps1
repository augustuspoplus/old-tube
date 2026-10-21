param(
    [string]$CommitMessage = "Update YouTube Year Time Machine extension"
)

$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

$ProjectDir = $PSScriptRoot
Set-Location $ProjectDir

# Always enforce GitHub account identity so local Windows username is never used
git config user.name "augustuspoplus"
git config user.email "49472861+augustuspoplus@users.noreply.github.com"

Write-Host "1. Packaging extension into dist/youtube-year-time-machine.zip..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path "$ProjectDir\dist" -Force | Out-Null
Compress-Archive -Path `
    "$ProjectDir\manifest.json", `
    "$ProjectDir\content.js", `
    "$ProjectDir\styles.css", `
    "$ProjectDir\popup.html", `
    "$ProjectDir\popup.js" `
    -DestinationPath "$ProjectDir\dist\youtube-year-time-machine.zip" -Force

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
$repoCheck = gh repo view augustuspoplus/yt-year-filter 2>&1
if ($LASTEXITCODE -ne 0) {
    git remote remove origin 2>$null
    Write-Host "   Creating fresh GitHub repository 'yt-year-filter' and pushing..." -ForegroundColor Green
    gh repo create yt-year-filter --public --source=. --remote=origin --push
} else {
    Write-Host "   Pushing latest commits to origin/main..." -ForegroundColor Green
    git push -u origin main
}

Write-Host "`nDone! Your extension is packaged and live on GitHub." -ForegroundColor Green
