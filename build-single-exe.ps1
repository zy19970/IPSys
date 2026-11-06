Set-Location $PSScriptRoot

dotnet publish .\src\IPSys.Web\IPSys.Web.csproj -c Release -r win-x64 --self-contained true -p:SelfContained=true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o .\artifacts\IPSys-Web-local-single
