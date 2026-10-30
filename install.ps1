param(
    [ValidateSet('en', 'zh_TW')][string]$Language,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$packageRoot = $PSScriptRoot
$nativeRoot = Join-Path $packageRoot 'native'
if (-not $Language) { $Language = if ((Get-UICulture).Name -like 'zh*') { 'zh_TW' } else { 'en' } }
$allStrings = Get-Content -LiteralPath (Join-Path $nativeRoot 'installer_strings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$strings = $allStrings.$Language
$basePython = $null
foreach ($candidate in @('py', 'python')) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if (-not $command) { continue }
    $arguments = @()
    if ($candidate -eq 'py') { $arguments += '-3' }
    $arguments += @('-c', 'import sys, tkinter; assert sys.version_info >= (3,10); print(sys.executable)')
    $pythonResult = & $command.Source @arguments 2>$null
    if ($LASTEXITCODE -eq 0 -and $pythonResult) { $basePython = ($pythonResult | Select-Object -Last 1).Trim(); break }
}
if (-not $basePython) { throw $strings.python }
$ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpegCommand) { throw $strings.ffmpeg }
& $ffmpegCommand.Source -version *> $null
if ($LASTEXITCODE -ne 0) { throw $strings.ffmpeg }
if ($CheckOnly) { Write-Host $strings.check; exit 0 }
Write-Host $strings.preparing
$venvRoot = Join-Path $nativeRoot '.venv'
if (-not (Test-Path -LiteralPath $venvRoot)) {
    & $basePython -m venv $venvRoot
    if ($LASTEXITCODE -ne 0) { throw $strings.venv }
}
$relativePython = '.venv\Scripts\python.exe'
$hostPython = Join-Path $nativeRoot $relativePython
if (-not (Test-Path -LiteralPath $hostPython)) {
    $relativePython = '.venv\bin\python.exe'
    $hostPython = Join-Path $nativeRoot $relativePython
}
& $hostPython -m pip install --disable-pip-version-check -r (Join-Path $nativeRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw $strings.pip }
$extensionId = (Get-Content -LiteralPath (Join-Path $packageRoot 'extension-id.txt') -Raw).Trim()
if ($extensionId -notmatch '^[a-p]{32}$') { throw 'Invalid extension ID.' }
$configPath = Join-Path $nativeRoot 'config.json'
if (Test-Path -LiteralPath $configPath) {
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $config | Add-Member -NotePropertyName ffmpeg -NotePropertyValue $ffmpegCommand.Source -Force
} else {
    $config = @{ ffmpeg = $ffmpegCommand.Source; connections_per_stream = 16; allow_insecure_tls = $false }
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 8), $utf8)
$launcherPath = Join-Path $nativeRoot 'launch.cmd'
# Relative ASCII launcher avoids embedding Windows usernames and Unicode paths.
$launcher = "@echo off`r`n`"%~dp0$relativePython`" -u `"%~dp0host.py`" %*`r`n"
[IO.File]::WriteAllText($launcherPath, $launcher, [Text.Encoding]::ASCII)
$manifestPath = Join-Path $nativeRoot 'com.local.bilibili_downloader.json'
$manifest = @{
    name = 'com.local.bilibili_downloader'
    description = 'Local Bilibili video downloader'
    path = $launcherPath
    type = 'stdio'
    allowed_origins = @("chrome-extension://$extensionId/")
}
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4), $utf8)
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.local.bilibili_downloader'
New-Item -Path $registryPath -Force | Out-Null
Set-Item -LiteralPath $registryPath -Value $manifestPath
Write-Host "`n$($strings.ready)"
Write-Host $strings.load
Write-Host (Join-Path $packageRoot 'extension')
Write-Host "$($strings.id) $extensionId"
