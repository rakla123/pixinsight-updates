param(
   [Parameter(Mandatory = $true)]
   [string] $Version,

   [string] $SourceDirectory = "",

   [string] $ReleaseTimestamp =
      [DateTime]::UtcNow.ToString("yyyyMMddHHmmss"),

   [switch] $Unsigned
)

$ErrorActionPreference = "Stop"

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
   throw "Version must use semantic form, for example 1.0.0."
}

$repositoryRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([String]::IsNullOrWhiteSpace($SourceDirectory)) {
   $SourceDirectory = Join-Path $repositoryRoot "source\RcAstro"
}
$sourceRoot = [IO.Path]::GetFullPath($SourceDirectory)
$buildRoot = Join-Path $repositoryRoot "build"
$stageRoot = Join-Path $buildRoot "stage"
$scriptRoot = Join-Path $stageRoot "src\scripts\FlapAstro\RcAstro"
$documentationRoot =
   Join-Path $stageRoot "doc\scripts\RC-Astro CLI Wrapper"
$packagesRoot = Join-Path $repositoryRoot "packages"
$packageName =
   "RC-Astro-CLI-Wrapper-$Version-$ReleaseTimestamp.zip"
$packagePath = Join-Path $packagesRoot $packageName

$requiredFiles = @(
   "RcAstro.js",
   "RcAstro.svg",
   "LICENSE.md",
   "NOTICE.md",
   "doc\scripts\RC-Astro CLI Wrapper\RC-Astro CLI Wrapper.html"
)

foreach ($relativePath in $requiredFiles) {
   $requiredPath = Join-Path $sourceRoot $relativePath
   if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
      throw "Required source file not found: $requiredPath"
   }
}

$scriptText = Get-Content (Join-Path $sourceRoot "RcAstro.js") -Raw
$versionPattern =
   'RCASTRO_WRAPPER_VERSION\s*=\s*"' +
   [regex]::Escape($Version) + '"'
if ($scriptText -notmatch $versionPattern) {
   throw "RcAstro.js does not declare wrapper version $Version."
}

if (Test-Path -LiteralPath $buildRoot) {
   $resolvedBuild = [IO.Path]::GetFullPath($buildRoot)
   $resolvedRepository = [IO.Path]::GetFullPath($repositoryRoot)
   if (-not $resolvedBuild.StartsWith(
      $resolvedRepository + [IO.Path]::DirectorySeparatorChar,
      [StringComparison]::OrdinalIgnoreCase)) {
      throw "Unsafe build directory: $resolvedBuild"
   }
   Remove-Item -LiteralPath $buildRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $scriptRoot -Force | Out-Null
New-Item -ItemType Directory -Path $documentationRoot -Force | Out-Null
New-Item -ItemType Directory -Path $packagesRoot -Force | Out-Null

foreach ($name in @(
   "RcAstro.js",
   "RcAstro.svg",
   "LICENSE.md",
   "NOTICE.md"
)) {
   Copy-Item -LiteralPath (Join-Path $sourceRoot $name) `
      -Destination (Join-Path $scriptRoot $name)
}

$signaturePath = Join-Path $sourceRoot "RcAstro.xsgn"
if ($Unsigned) {
   Write-Warning (
      "Building an unsigned package. Use this only until the FlapAstro " +
      "identity is listed by lscpd."
   )
}
elseif (Test-Path -LiteralPath $signaturePath -PathType Leaf) {
   Copy-Item -LiteralPath $signaturePath `
      -Destination (Join-Path $scriptRoot "RcAstro.xsgn")
}
else {
   throw (
      "RcAstro.xsgn was not found. Sign RcAstro.js first, or explicitly " +
      "build with -Unsigned."
   )
}

Copy-Item -LiteralPath (
   Join-Path $sourceRoot `
      "doc\scripts\RC-Astro CLI Wrapper\RC-Astro CLI Wrapper.html"
) -Destination (
   Join-Path $documentationRoot "RC-Astro CLI Wrapper.html"
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path -LiteralPath $packagePath) {
   Remove-Item -LiteralPath $packagePath
}

$archive = [IO.Compression.ZipFile]::Open(
   $packagePath,
   [IO.Compression.ZipArchiveMode]::Create
)
try {
   Get-ChildItem -LiteralPath $stageRoot -Recurse -File |
      Sort-Object FullName |
      ForEach-Object {
         $entryName = $_.FullName.Substring($stageRoot.Length + 1).
            Replace("\", "/")
         [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive,
            $_.FullName,
            $entryName,
            [IO.Compression.CompressionLevel]::Optimal
         ) | Out-Null
      }
}
finally {
   $archive.Dispose()
}

$sha1 = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA1).
   Hash.ToLowerInvariant()
$manifestPath = Join-Path $repositoryRoot "updates.xri"

$manifest = @"
<?xml version="1.0" encoding="UTF-8"?>
<xri version="1.0">
   <description>
      <p>FlapAstro scripts for PixInsight.</p>
   </description>
   <platform os="all" arch="noarch" version="1.9.4:1.9.99">
      <package fileName="packages/$packageName" sha1="$sha1" type="script" releaseDate="$ReleaseTimestamp">
         <title>RC-Astro CLI Wrapper $Version</title>
         <description>
            <p>PixInsight graphical interface for BlurXTerminator, StarXTerminator, and NoiseXTerminator through the stand-alone RC-Astro CLI.</p>
            <p>Requires RC-Astro CLI version 1.0.0 or newer.</p>
         </description>
      </package>
   </platform>
</xri>
"@

[IO.File]::WriteAllText(
   $manifestPath,
   $manifest,
   (New-Object Text.UTF8Encoding($false))
)

Write-Host "Package:  $packagePath"
Write-Host "SHA-1:    $sha1"
Write-Host "Manifest: $manifestPath"
Write-Host ""
if ($Unsigned) {
   Write-Warning (
      "Publish updates.xri without signing it. Users must allow unsigned " +
      "scripts in PixInsight."
   )
}
else {
   Write-Host "Next: sign updates.xri with PixInsight CodeSign, then publish."
}
