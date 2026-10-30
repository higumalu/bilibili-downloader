$ErrorActionPreference = 'Stop'
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.local.bilibili_downloader'
if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath }
Write-Host 'Local helper unregistered. Remove the extension from chrome://extensions.'
Write-Host 'Downloaded videos have been kept.'
