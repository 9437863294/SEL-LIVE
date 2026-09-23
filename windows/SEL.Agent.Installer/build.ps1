<#
.SYNOPSIS
    Builds the SEL LIVE Agent setup program.

.DESCRIPTION
    Publishes the agent and the service in Release, packages them into an MSI with WiX 5, then
    wraps that MSI and its prerequisites into a single self-contained installer:

        bin\SEL.Agent-Setup-<version>.exe

    That one file is the whole product. It carries .NET Framework 4.8 and the Edge WebView2
    bootstrapper inside it, installs whichever of them the PC is missing, and then installs the
    agent — asking for administrator approval exactly once. Nothing else needs to be copied to
    the target machine.

    Run from anywhere:

        pwsh windows/SEL.Agent.Installer/build.ps1
        pwsh windows/SEL.Agent.Installer/build.ps1 -Sign -CertificateThumbprint ABC123...
        pwsh windows/SEL.Agent.Installer/build.ps1 -OfflineWebView2     # air-gapped sites
        pwsh windows/SEL.Agent.Installer/build.ps1 -SkipBundle -KeepMsi # MSI only, for GPO

    The setup installs on Windows 7 SP1 through Windows 11 even though WiX 5 needs a modern SDK
    to build it — see the note at the top of Package.wxs. Only this machine needs anything
    current.

.NOTES
    Prerequisites on the BUILD machine only:
      * .NET SDK 8 or later (for `dotnet build`; the projects themselves target .NET Framework)
      * `dotnet tool install --global wix --version 5.0.2`
      * `wix extension add -g WixToolset.Util.wixext/5.0.2`
      * `wix extension add -g WixToolset.UI.wixext/5.0.2`
      * `wix extension add -g WixToolset.BootstrapperApplications.wixext/5.0.2`
      * signtool.exe from the Windows SDK, if -Sign is used
      * Internet access on the first run, to fetch the redistributables into redist\.
        They are cached there afterwards and are not committed to the repository.

    Pin the extension versions. `wix extension add` without one resolves to the newest release,
    which is currently 7.0.0 and is silently rejected by WiX 5 with a WIX6101 warning and no
    extension installed.
#>

[CmdletBinding()]
param(
    [string]$Configuration = 'Release',

    # Override to produce an MSI whose agent runs on Windows 8.0. See Directory.Build.props.
    [string]$TargetFramework = 'net48',

    [string]$Version = '1.3.0.0',

    # §43 requires the agent to verify an update's Authenticode signature before running it, which
    # means the installer has to carry one. An unsigned MSI is fine for a pilot and is not fine
    # for a fleet: it is the thing that stops a compromised update server owning every PC.
    [switch]$Sign,
    [string]$CertificateThumbprint,
    [string]$TimestampUrl = 'http://timestamp.digicert.com',

    # Produce only the MSI. Leaves bin\ without a setup .exe, so use it only when something
    # downstream consumes the MSI directly.
    [switch]$SkipBundle,

    # Also copy the MSI to bin\. The bundle embeds it, so it is normally a build intermediate
    # and stays in obj\ — but Group Policy software installation and Intune's Win32 wrapper both
    # want a bare MSI, and neither can consume a Burn bundle's silent switches.
    [switch]$KeepMsi,

    # Embed the full 188 MB WebView2 runtime instead of its 2 MB bootstrapper. Only worth it for
    # sites with no internet at all; everywhere else the bootstrapper downloads it, and where it
    # cannot, the agent falls back to the user's own browser.
    [switch]$OfflineWebView2,

    # The expected SHA-256 of the offline WebView2 runtime. See the -OfflineWebView2 branch for
    # why this is a parameter rather than a constant.
    [string]$WebView2Sha256,

    # Fail rather than download a missing redistributable. For build servers with no egress,
    # where redist\ is populated from an internal mirror.
    [switch]$NoDownload
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$windowsRoot = Split-Path -Parent $here
$stage = Join-Path $here 'obj\stage'
$serviceStage = Join-Path $here 'obj\service'
$redist = Join-Path $here 'redist'
$outputDir = Join-Path $here 'bin'

# The MSI is a build intermediate: the bundle embeds it, and bin\ should hold exactly the files
# somebody is meant to copy to a PC. -KeepMsi and -SkipBundle put it back in bin\.
$msi = Join-Path $here "obj\SEL.Agent-$Version.msi"
$setup = Join-Path $outputDir "SEL.Agent-Setup-$Version.exe"

Write-Host "Building the SEL LIVE Agent installer" -ForegroundColor Cyan
Write-Host "  Configuration     : $Configuration"
Write-Host "  Target framework  : $TargetFramework"
Write-Host "  Version           : $Version"
Write-Host ("  Output            : {0}" -f $(if ($SkipBundle) { 'MSI only' } else { 'single setup .exe' }))

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

# ── 4. Package the MSI ───────────────────────────────────────────────────────────────────────

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

# The unnamed bindpath is what makes "run from anywhere" true.
#
# WiX resolves a relative SourceFile — License.rtf here, the redistributables in Bundle.wxs —
# against the process's current directory, not against the .wxs that mentions it. Without this
# the build works when invoked from the installer folder and fails with "Cannot find the
# Control file 'License.rtf'" from anywhere else, which is a maddening thing to debug on a
# build server.
& wix build `
    (Join-Path $here 'Package.wxs') `
    -arch x86 `
    -bindpath $here `
    -bindpath "bin=$stage" `
    -bindpath "svc=$serviceStage" `
    -ext WixToolset.Util.wixext `
    -ext WixToolset.UI.wixext `
    -d Version=$Version `
    -pdb (Join-Path $here 'obj\SEL.Agent.wixpdb') `
    -o $msi
if ($LASTEXITCODE -ne 0) { throw "WiX packaging failed." }

# The .wixpdb goes to obj\, not next to the package.
#
# It is a build symbol file — useful for patching and for decoding an installer log, and of no
# use whatsoever on a target PC. Left in bin\ it sits beside the installer looking like a second
# file somebody has to copy, which is exactly the confusion "the installer should be one
# package" is about.

if ($Sign) {
    & signtool sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $msi
    if ($LASTEXITCODE -ne 0) { throw "Signing the MSI failed." }
}

Write-Host ("  MSI built ({0:N1} MB)" -f ((Get-Item $msi).Length / 1MB))

# ── 5. Fetch the redistributables the bundle embeds ──────────────────────────────────────────
#
# Cached in redist\ and reused. They are large, immutable and published by Microsoft, so there
# is no reason to fetch them twice and every reason not to commit them — redist\ is gitignored.
#
# The hashes are checked, and that is not ceremony. These files are embedded into an installer
# that will be run with administrator rights on every PC in the estate; a truncated download or
# a hijacked mirror is exactly the thing worth catching at build time rather than never.

function Get-Redistributable {
    param(
        [string]$Name,
        [string]$Url,
        [string]$Sha256,
        [string]$Description
    )

    $path = Join-Path $redist $Name

    if (Test-Path $path) {
        $actual = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -eq $Sha256) { return $path }
        Write-Host "  $Name is cached but its hash does not match; re-downloading." -ForegroundColor Yellow
        Remove-Item $path -Force
    }

    if ($NoDownload) {
        throw "$Name is missing from $redist and -NoDownload was given. Copy it there from an internal mirror ($Description, expected SHA-256 $Sha256)."
    }

    New-Item -ItemType Directory -Path $redist -Force | Out-Null
    Write-Host "  Downloading $Description..."

    # Invoke-WebRequest's progress bar makes a 121 MB download roughly three times slower in
    # Windows PowerShell, because it repaints the console on every buffer.
    $previous = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri $Url -OutFile $path -UseBasicParsing
    }
    finally {
        $ProgressPreference = $previous
    }

    $actual = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256) {
        Remove-Item $path -Force
        throw "$Name downloaded with SHA-256 $actual, expected $Sha256. Refusing to embed it."
    }

    return $path
}

if (-not $SkipBundle) {
    Write-Host "Preparing prerequisites" -ForegroundColor Cyan

    Get-Redistributable `
        -Name 'NDP48-x86-x64-AllOS-ENU.exe' `
        -Url 'https://go.microsoft.com/fwlink/?linkid=2088631' `
        -Sha256 '0a3a390c47e639d0f7fc65b21195fee6b7f65b066f80f70c60fab191d14b7e40' `
        -Description '.NET Framework 4.8 offline installer (121 MB)' | Out-Null

    if ($OfflineWebView2) {
        # The full runtime. /silent /install is the same switch set as the bootstrapper's, so
        # only the payload changes.
        #
        # No hash is pinned here, and it cannot be. Microsoft revises the Evergreen standalone
        # installer continuously and the fwlink always points at the current build, so any
        # constant written into this script would start failing within weeks and look like a
        # compromised download. Instead: fetch it once, record what you got, and pass that hash
        # on later builds so a mirrored copy is still verified.
        $webView2Name = 'MicrosoftEdgeWebView2RuntimeInstallerX86.exe'
        $webView2Path = Join-Path $redist $webView2Name

        if (-not (Test-Path $webView2Path)) {
            if ($NoDownload) { throw "$webView2Name is missing from $redist and -NoDownload was given." }
            New-Item -ItemType Directory -Path $redist -Force | Out-Null
            Write-Host "  Downloading Edge WebView2 offline runtime (188 MB)..."
            $previous = $ProgressPreference
            $ProgressPreference = 'SilentlyContinue'
            try {
                Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2099617' -OutFile $webView2Path -UseBasicParsing
            }
            finally { $ProgressPreference = $previous }
        }

        $actual = (Get-FileHash $webView2Path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($WebView2Sha256) {
            if ($actual -ne $WebView2Sha256) {
                throw "$webView2Name has SHA-256 $actual, but -WebView2Sha256 said $WebView2Sha256. Refusing to embed it."
            }
        }
        else {
            Write-Host "  WebView2 runtime SHA-256 is $actual" -ForegroundColor Yellow
            Write-Host "  Not verified. Pass -WebView2Sha256 $actual on later builds to pin it." -ForegroundColor Yellow
        }
    }
    else {
        $webView2Name = 'MicrosoftEdgeWebview2Setup.exe'
        Get-Redistributable `
            -Name $webView2Name `
            -Url 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' `
            -Sha256 '81c01751c8cc385a5991abb104205d42ac70094350ee8fb9e8ea580b51bb9554' `
            -Description 'Edge WebView2 bootstrapper (2 MB)' | Out-Null
    }
}

# ── 6. Wrap everything into one setup .exe ───────────────────────────────────────────────────

if (-not $SkipBundle) {
    Write-Host "Packaging the setup program" -ForegroundColor Cyan

    # Built up as explicit strings. A parenthesised expression inside an unquoted native-command
    # argument is parsed inconsistently between PowerShell editions, and these two carry
    # absolute paths with a space in them ("Application Dev"), which is precisely where that
    # inconsistency turns into a WiX error about a file it cannot find.
    $webView2Payload = Join-Path $redist $webView2Name

    & wix build `
        (Join-Path $here 'Bundle.wxs') `
        -arch x86 `
        -bindpath $here `
        -ext WixToolset.Util.wixext `
        -ext WixToolset.BootstrapperApplications.wixext `
        -d "Version=$Version" `
        -d "MsiPath=$msi" `
        -d "WebView2Payload=$webView2Payload" `
        -pdb (Join-Path $here 'obj\SEL.Agent-Setup.wixpdb') `
        -o $setup
    if ($LASTEXITCODE -ne 0) { throw "WiX bundling failed." }

    # ── Signing a Burn bundle takes three steps, not one ─────────────────────────────────────
    #
    # A bundle is an executable with its payloads appended to it. Signing it directly would
    # produce a signature over the whole file, which Burn then invalidates the moment it
    # extracts itself at run time — and Windows would report the installer as tampered with.
    #
    # The documented sequence is to detach the engine, sign that, reattach it and sign the
    # result. Both signatures matter: the engine's is what SmartScreen and the agent's own
    # update check verify, and the outer one is what a user sees in the file's properties.

    if ($Sign) {
        $engine = Join-Path $here 'obj\SEL.Agent-Setup.engine.exe'

        & wix burn detach $setup -engine $engine
        if ($LASTEXITCODE -ne 0) { throw "Detaching the bundle engine failed." }

        & signtool sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $engine
        if ($LASTEXITCODE -ne 0) { throw "Signing the bundle engine failed." }

        & wix burn reattach $setup -engine $engine -o $setup
        if ($LASTEXITCODE -ne 0) { throw "Reattaching the bundle engine failed." }

        & signtool sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $setup
        if ($LASTEXITCODE -ne 0) { throw "Signing the bundle failed." }
    }
}

# The MSI belongs in bin\ only when something is going to deploy it directly.
if ($KeepMsi -or $SkipBundle) {
    Copy-Item $msi $outputDir -Force
}

# ── 7. Report ────────────────────────────────────────────────────────────────────────────────
#
# The SHA-256 is printed because it is what goes into the `packageSha256` field of the agent
# version record in SEL LIVE. The agent refuses to run an update whose hash does not match, so
# this value is not optional metadata — publishing the wrong one means the update silently never
# applies, which is a much harder problem to notice than one that fails loudly.

$product = if ($SkipBundle) { Join-Path $outputDir (Split-Path $msi -Leaf) } else { $setup }
$hash = (Get-FileHash $product -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item $product).Length

Write-Host ""
Write-Host "Built $product" -ForegroundColor Green
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
    Write-Host "agent's update check verifies the Authenticode subject before it runs an installer," -ForegroundColor Yellow
    Write-Host "and an unsigned setup .exe also collects a SmartScreen warning on every PC." -ForegroundColor Yellow
}
Write-Host ""
if ($SkipBundle) {
    Write-Host "Install with:" -ForegroundColor Cyan
    Write-Host "  msiexec /i `"$product`" /qn ENROLLMENTCODE=SEL-HO-2026"
    Write-Host "  (APIBASEURL defaults to https://seltech.store; pass it only for a staging server)"
    Write-Host "  (requires .NET Framework 4.8 to be present already)"
}
else {
    Write-Host "Hand this one file to whoever is installing. It needs an administrator:" -ForegroundColor Cyan
    Write-Host "  double-click, approve the Windows prompt"
    Write-Host ""
    Write-Host "Unattended, for GPO or SCCM:" -ForegroundColor Cyan
    Write-Host "  `"$([IO.Path]::GetFileName($product))`" /quiet ENROLLMENTCODE=SEL-HO-2026"
    Write-Host "  (APIBASEURL defaults to https://seltech.store; pass it only for a staging server)"
    Write-Host "  `"$([IO.Path]::GetFileName($product))`" /uninstall /quiet"
    Write-Host "  `"$([IO.Path]::GetFileName($product))`" /log setup.log        (when it goes wrong)"
    if ($KeepMsi) {
        Write-Host ""
        Write-Host "The bare MSI is in bin\ as well, for Group Policy software installation." -ForegroundColor Cyan
    }
}
