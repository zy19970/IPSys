# Validate files created by the REAL Edge/Windows save picker.
# This script never downloads from the service or forges a saved-file result.
# Manifest example:
# {"zipPath":"C:\\IPSys-QA\\exports\\real.zip","requireZip64":true,
#  "files":[{"sourcePath":"C:\\IPSys-QA\\inputs\\original.bin",
#            "zipEntry":"项目甲/合同甲/original.bin"}]}
param(
    [Parameter(Mandatory=$true)][string]$Manifest,
    [string]$EvidenceDirectory = "",
    [switch]$RequireIndependentExtractor
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
$manifestPath=(Resolve-Path -LiteralPath $Manifest).Path
$m=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if(-not $m.zipPath -or -not $m.files -or @($m.files).Count -lt 1) {
    throw 'Manifest must contain zipPath and files with sourcePath/zipEntry.'
}
$zipPath=(Resolve-Path -LiteralPath $m.zipPath).Path
$zipInfo=Get-Item -LiteralPath $zipPath
if(-not $EvidenceDirectory) {$EvidenceDirectory=Split-Path -Parent $manifestPath}
New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
$requireZip64=[bool]$m.requireZip64
$report=[ordered]@{
    generatedAt=(Get-Date).ToString('o')
    sourceManifest=$manifestPath; zipPath=$zipPath; zipBytes=[long]$zipInfo.Length
    requiredZip64=$requireZip64; zip64LocatorFound=$false
    zip64EocdFound=$false; independentExtractor='NOT_RUN'; files=@(); errors=@()
}
$zipStream=$null
$archive=$null
try {
    $zipStream=[System.IO.File]::Open($zipPath,[System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,[System.IO.FileShare]::Read)
    # ZIP64 end records are adjacent to the classic EOCD, in the last 65,633 bytes.
    $tailSize=[int][Math]::Min([long]$zipStream.Length,131072L)
    $tail=New-Object byte[] $tailSize
    $zipStream.Seek(-$tailSize,[System.IO.SeekOrigin]::End)|Out-Null
    $got=$zipStream.Read($tail,0,$tail.Length)
    if($got -ne $tailSize){throw 'Could not read ZIP tail.'}
    for($i=0;$i -le $tail.Length-4;$i++) {
        $sig=[BitConverter]::ToUInt32($tail,$i)
        if($sig -eq 0x06064b50){$report.zip64EocdFound=$true}
        if($sig -eq 0x07064b50){$report.zip64LocatorFound=$true}
    }
    if($requireZip64) {
        if($zipInfo.Length -le 4294967295L){throw 'ZIP is not larger than 4 GiB.'}
        if(-not $report.zip64LocatorFound -or -not $report.zip64EocdFound){
            throw 'ZIP64 EOCD or locator was not found in the real ZIP file.'
        }
    }
    $zipStream.Position=0
    $archive=[System.IO.Compression.ZipArchive]::new($zipStream,
        [System.IO.Compression.ZipArchiveMode]::Read,$true)
    $all=@($archive.Entries | Where-Object {$_.Name -ne ''})
    if($all.Count -ne @($m.files).Count){throw ('ZIP entry count {0} differs from manifest {1}.' -f $all.Count,@($m.files).Count)}
    foreach($f in @($m.files)){
        $src=(Resolve-Path -LiteralPath $f.sourcePath).Path
        $entry=$archive.GetEntry([string]$f.zipEntry)
        if($null -eq $entry){throw ('Missing ZIP entry: '+$f.zipEntry)}
        $srcInfo=Get-Item -LiteralPath $src
        if([long]$entry.Length -ne [long]$srcInfo.Length){
            throw ('Size differs: '+$f.zipEntry)}
        $srcSha=(Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash.ToUpperInvariant()
        $entryStream=$entry.Open()
        try{
            $hasher=[System.Security.Cryptography.SHA256]::Create()
            try{$entrySha=[Convert]::ToHexString($hasher.ComputeHash($entryStream))}
            finally{$hasher.Dispose()}
        }finally{$entryStream.Dispose()}
        if($srcSha -ne $entrySha){throw ('SHA-256 mismatch: '+$f.zipEntry)}
        $report.files+=@{entry=$f.zipEntry;sourcePath=$src;size=[long]$entry.Length
            sourceSha256=$srcSha;entrySha256=$entrySha;shaMatch=$true}
    }
    $archive.Dispose();$archive=$null
    $zipStream.Dispose();$zipStream=$null
    # Optional independent 7-Zip validation; .NET ZipArchive is not the same engine.
    $seven=Get-Command 7z,7za -ErrorAction SilentlyContinue | Select-Object -First 1
    if($seven){
        & $seven.Source t -bd -- $zipPath | Out-Null
        if($LASTEXITCODE -ne 0){throw '7-Zip independent integrity check failed'}
        $report.independentExtractor='7z:PASS'
    } elseif($RequireIndependentExtractor) {
        throw 'Independent 7-Zip extractor not found; install 7z and rerun.'
    } else {
        $report.independentExtractor='NOT_RUN:7z missing'
    }
} catch {
    $report.errors+=($_.Exception.Message)
} finally {
    if($archive){$archive.Dispose()}
    if($zipStream){$zipStream.Dispose()}
    $report.result= if(@($report.errors).Count -eq 0) {
      if($RequireIndependentExtractor -and $report.independentExtractor -ne '7z:PASS') {'BLOCKED'} else {'PASS'}
    } else {'FAIL'}
    $reportPath=Join-Path $EvidenceDirectory 'explorer-export-audit.json'
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
    Write-Output ("Evidence: "+$reportPath)
    Write-Output ("Result: "+$report.result)
}
if($report.result -ne 'PASS'){exit 1}
