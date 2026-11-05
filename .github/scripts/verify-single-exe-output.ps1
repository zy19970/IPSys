# Release packaging invariant: IPSys serves its browser UI from embedded
# resources. A cold .NET Web SDK publish may leave a directory named wwwroot.
# Remove it ONLY if it is empty; fail loudly if any actual asset was copied.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$PublishDirectories
)

$ErrorActionPreference = 'Stop'
foreach ($folder in $PublishDirectories) {
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) {
        throw "Release publish directory missing: $folder"
    }
    $exe = Join-Path $folder 'IPSys.Web.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
        throw "Release executable missing: $exe"
    }

    $wwwroot = Join-Path $folder 'wwwroot'
    if (Test-Path -LiteralPath $wwwroot) {
        $rootItem = Get-Item -LiteralPath $wwwroot -Force
        if (-not $rootItem.PSIsContainer -or
            ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Unexpected wwwroot file or link in release output: $wwwroot"
        }
        $descendants = @(Get-ChildItem -LiteralPath $wwwroot -Recurse -Force -ErrorAction Stop)
        $unexpectedAssets = @($descendants | Where-Object {
            -not $_.PSIsContainer -or
            ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
        })
        if ($unexpectedAssets.Count -gt 0) {
            $unexpectedAssets | Select-Object FullName,Length,Attributes |
                Format-Table -AutoSize | Out-String | Write-Host
            throw "Nonempty wwwroot in release output: $wwwroot. Fix the Web SDK content copy rules; do not discard assets."
        }
        # No files/symlinks: removing an empty directory tree is safe.
        Remove-Item -LiteralPath $wwwroot -Force -Recurse
        Write-Host "Removed empty wwwroot directory tree: $wwwroot"
    }

    $unexpected = @(Get-ChildItem -LiteralPath $folder -Force -ErrorAction Stop |
        Where-Object { $_.Name -ne 'IPSys.Web.exe' })
    if ($unexpected.Count -gt 0) {
        $unexpected | Select-Object FullName,Length,Attributes |
            Format-Table -AutoSize | Out-String | Write-Host
        throw "Release output must contain only IPSys.Web.exe: $folder"
    }
    Write-Host "Single EXE release layout PASS: $folder"
}
