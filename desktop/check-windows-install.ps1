param([string]$Installer)
$ErrorActionPreference = 'Stop'
# NSIS updates per-user uninstall registration and shortcuts: run only in a disposable CI VM.
if ($env:CI -ne 'true') { throw 'Run this installer test in a disposable CI Windows VM with CI=true.' }
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $PSScriptRoot 'app/package.json') -Raw | ConvertFrom-Json).version
if (!$Installer) { $Installer = Join-Path $root "output/installers/QuanDeck-$version-win-x64-Setup.exe" }
$Installer = (Resolve-Path $Installer).Path
$temp = Join-Path ([IO.Path]::GetTempPath()) ("QuanDeck-InstallCheck-" + [guid]::NewGuid().ToString('N'))
$installDir = Join-Path $temp 'Application'
$smoke = Join-Path $temp 'smoke.json'
$profile = Join-Path $temp 'profile'
$userData = Join-Path $env:APPDATA 'QuanDeck'
$marker = Join-Path $userData 'installer-preserve-check.txt'
New-Item -ItemType Directory -Force -Path $temp,$userData | Out-Null
Set-Content $marker 'Keep task data when uninstalling'
try {
  $setup = Start-Process -FilePath $Installer -ArgumentList @('/S', '/currentuser', "/D=$installDir") -Wait -PassThru
  if ($setup.ExitCode -ne 0) { throw "Installer exited with $($setup.ExitCode)" }
  $executable = Join-Path $installDir 'QuanDeck.exe'
  if (!(Test-Path $executable)) { throw 'Installed executable missing' }
  $env:QUANDECK_SMOKE_OUTPUT = $smoke
  $env:QUANDECK_SMOKE_DATA = $profile
  $app = Start-Process -FilePath $executable -ArgumentList '--smoke-test' -PassThru
  if (!$app.WaitForExit(90000)) { $app.Kill(); throw 'Application startup timed out' }
  if ($app.ExitCode -ne 0) { throw "Application exited with $($app.ExitCode)" }
  $launch = Get-Content $smoke -Raw | ConvertFrom-Json
  if (!$launch.ok -or $launch.version -ne $version) { throw 'Installed application smoke test failed' }
  $uninstaller = Get-ChildItem -Path $installDir -Filter 'Uninstall*.exe' | Select-Object -First 1
  if (!$uninstaller) { throw 'Uninstaller missing' }
  $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList @('/S', '/currentuser') -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited with $($uninstall.ExitCode)" }
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ((Test-Path $executable) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 500 }
  if (Test-Path $executable) { throw 'Uninstaller did not remove the application' }
  if (!(Test-Path $marker)) { throw 'Uninstaller removed user task data' }
  $result = @{ ok=$true; installer=(Split-Path $Installer -Leaf); installed=$true; launch=$launch; uninstalled=$true; userDataPreserved=$true }
  $result | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $root 'output/windows-install-check.json')
  $result | ConvertTo-Json -Depth 8 | Write-Output
} finally {
  Remove-Item Env:QUANDECK_SMOKE_OUTPUT -ErrorAction SilentlyContinue
  Remove-Item Env:QUANDECK_SMOKE_DATA -ErrorAction SilentlyContinue
  Remove-Item $marker -Force -ErrorAction SilentlyContinue
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
