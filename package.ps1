param(
    [switch]$BumpPatch
)

$ProjectDir = $PSScriptRoot
Set-Location $ProjectDir

if ($BumpPatch) {
    $manifestPath = Join-Path $ProjectDir "manifest.json"
    $manifestRaw = Get-Content $manifestPath -Raw
    if ($manifestRaw -match '"version":\s*"(\d+)\.(\d+)\.(\d+)"') {
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]
        $patch = [int]$Matches[3] + 1
        $newVersion = "$major.$minor.$patch"
        $manifestRaw = $manifestRaw -replace '"version":\s*"\d+\.\d+\.\d+"', "`"version`": `"$newVersion`""
        Set-Content -Path $manifestPath -Value $manifestRaw -NoNewline -Encoding utf8
        Write-Host "   Bumped manifest.json version to $newVersion" -ForegroundColor Green
    }
}

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
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $fullPath, $relPath)
    }
}

$archive.Dispose()
$zipStream.Dispose()
