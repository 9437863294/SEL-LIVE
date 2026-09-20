<#
.SYNOPSIS
    Builds the SEL LIVE Agent MSI.

.DESCRIPTION
    Publishes the agent and the service in Release, then packages the output with WiX 5.

    Run from anywhere:

        pwsh windows/SEL.Agent.Installer/build.ps1
        pwsh windows/SEL.Agent.Installer/build.ps1 -Sign -CertificateThumbprint ABC123...

    The MSI installs on Windows 7 SP1 through Windows 11 even though WiX 5 needs a modern SDK to
    build it — see the note at the top of Package.wxs. Only this machine needs anything current.

.NOTES
    Prerequisites on the BUILD machine only:
      * .NET SDK 8 or later (for `dotnet build`; the projects themselves target .NET Framework)
      * `dotnet tool install --global wix --version 5.0.2`
      * `wix extension add -g WixToolset.Util.wixext WixToolset.UI.wixext`
      * signtool.exe from the Windows SDK, if -Sign is used
#>

[CmdletBinding()]
param(
    [string]$Configuration = 'Release',

    # Override to produce an MSI whose agent runs on Windows 8.0. See Directory.Build.props.
    [string]$TargetFramework = 'net48',

    [string]$Version = '1.0.0.0',

    # §43 requires the agent to verify an update's Authenticode signature before running it, which
    # means the installer has to carry one. An unsigned MSI is fine for a pilot and is not fine
    # for a fleet: it is the thing that stops a compromised update server owning every PC.
    [switch]$Sign,
    [string]$CertificateThumbprint,
    [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$windowsRoot = Split-Path -Parent $here
$stage = Join-Path $here 'obj\stage'
$serviceStage = Join-Path $here 'obj\service'
$outputDir = Join-Path $here 'bin'
$msi = Join-Path $outputDir "SEL.Agent-$Version.msi"

Write-Host "Building the SEL LIVE Agent installer" -ForegroundColor Cyan
Write-Host "  Configuration     : $Configuration"
Write-Host "  Target framework  : $TargetFramework"
Write-Host "  Version           : $Version"

# ── 1. Build ─────────────────────────────────────────────────────────────────────────────────

& dotnet build (Join-Path $windowsRoot 'SEL.Agent.sln') `
    -c $Configuration `
    -p:SelAgentTargetFramework=$TargetFramework `
    -p:Version=$Version `
    -p:FileVersion=$Version `
    -p:AssemblyVersion=$Version `
    --nologo
if ($LASTEXITCODE -ne 0) { throw "The solution did not build." }

# ── 2. Stage ─────────────────────────────────────────────────────────────────────────────────
#
# The desktop agent and the service are separate executables that share Core and its
# dependencies, so their output directories overlap almost entirely. Copying both into one stage
# and letting later files win is correct: the shared assemblies are byte-identical, having come
# from the same build.

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $serviceStage) { Remove-Item $serviceStage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path $serviceStage -Force | Out-Null

foreach ($project in @('SEL.Agent', 'SEL.Agent.Service')) {
    $source = Join-Path $windowsRoot "$project\bin\$Configuration\$TargetFramework"
    if (-not (Test-Path $source)) { throw "Build output not found: $source" }
    Copy-Item (Join-Path $source '*') $stage -Recurse -Force
}

# The service executable moves to its own staging directory.
#
# ServiceInstall takes its image path from the parent component's KeyPath file, so the service
# binary has to be an explicit <File> rather than part of the harvested set. Leaving it in both
# produces two File rows for one path — a short-filename collision WiX warns about and Windows
# Installer resolves unpredictably. Two directories makes the split structural instead of
# depending on an exclude pattern staying correct.
foreach ($name in @('SEL.Agent.Service.exe', 'SEL.Agent.Service.exe.config')) {
    $from = Join-Path $stage $name
    if (Test-Path $from) { Move-Item $from (Join-Path $serviceStage $name) -Force }
}
if (-not (Test-Path (Join-Path $serviceStage 'SEL.Agent.Service.exe'))) {
    throw "SEL.Agent.Service.exe was not produced by the build."
}

# .pdb files are debugging symbols. They roughly double the package size, are of no use on a
# user's PC, and make it marginally easier to reverse-engineer the agent. Removed rather than
# shipped and ignored.
Get-ChildItem $stage -Filter '*.pdb' -Recurse | Remove-Item -Force
Get-ChildItem $stage -Filter '*.xml' -Recurse |
    Where-Object { Test-Path ([IO.Path]::ChangeExtension($_.FullName, '.dll')) } |
    Remove-Item -Force

Write-Host ("  Staged {0} files" -f (Get-ChildItem $stage -Recurse -File).Count)

# ── 3. Sign the binaries, before packaging ───────────────────────────────────────────────────
#
# Order matters: signing the MSI does not sign what is inside it. An agent that verifies the
# signature of a downloaded update (§43) is verifying the *installer's* signature, and the
# executables it lays down should carry their own so that a file replaced on disk afterwards is
# detectable.

if ($Sign) {
    if (-not $CertificateThumbprint) { throw "-Sign requires -CertificateThumbprint." }
    $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if (-not $signtool) { throw "signtool.exe was not found. Install the Windows SDK, or add it to PATH." }

    $toSign = Get-ChildItem $stage -Include '*.exe', '*.dll' -Recurse |
        Where-Object { $_.Name -like 'SEL.*' }
    foreach ($file in $toSign) {
        & $signtool.Source sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $file.FullName
        if ($LASTEXITCODE -ne 0) { throw "Signing failed for $($file.Name)." }
    }
    Write-Host ("  Signed {0} binaries" -f $toSign.Count)
}

# ── 4. Package ───────────────────────────────────────────────────────────────────────────────

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

& wix build `
    (Join-Path $here 'Package.wxs') `
    -arch x86 `
    -bindpath "bin=$stage" `
    -bindpath "svc=$serviceStage" `
    -ext WixToolset.Util.wixext `
    -ext WixToolset.UI.wixext `
    -d Version=$Version `
    -o $msi
if ($LASTEXITCODE -ne 0) { throw "WiX packaging failed." }

if ($Sign) {
    & signtool sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $msi
    if ($LASTEXITCODE -ne 0) { throw "Signing the MSI failed." }
}

# ── 5. Report ────────────────────────────────────────────────────────────────────────────────
#
# The SHA-256 is printed because it is what goes into the `packageSha256` field of the agent
# version record in SEL LIVE. The agent refuses to run an update whose hash does not match, so
# this value is not optional metadata — publishing the wrong one means the update silently never
# applies, which is a much harder problem to notice than one that fails loudly.

$hash = (Get-FileHash $msi -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item $msi).Length

Write-Host ""
Write-Host "Built $msi" -ForegroundColor Green
Write-Host "  SHA-256 : $hash"
Write-Host "  Size    : $([math]::Round($size / 1MB, 2)) MB"
Write-Host ""
Write-Host "Publish in SEL LIVE at /windows-agent/versions with:" -ForegroundColor Cyan
Write-Host "  version        $Version"
Write-Host "  packageSha256  $hash"
Write-Host "  packageUrl     (wherever you host it, https only)"
if (-not $Sign) {
    Write-Host ""
    Write-Host "NOT SIGNED. Fine for a pilot; do not roll this out to a fleet unsigned — the" -ForegroundColor Yellow
    Write-Host "agent's update check verifies the Authenticode subject before it runs an installer." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Install with:" -ForegroundColor Cyan
Write-Host "  msiexec /i `"$msi`" /qn APIBASEURL=https://sel.example.com FIREBASEAPIKEY=AIza... ENROLLMENTCODE=SEL-HO-2026"
