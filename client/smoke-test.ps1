$ErrorActionPreference = 'Stop'
$env:APPDATA = Join-Path $env:RUNNER_TEMP 'mcbot-client-smoke'
$root = New-Item -ItemType Directory -Path (Join-Path $env:APPDATA '.minecraft') -Force
$launcherFiles = @('launcher_profiles.json', 'launcher_profiles_microsoft_store.json')
foreach ($file in $launcherFiles) {
    '{"profiles":{"vanilla":{"name":"Keep me"}},"settings":{"keep":true}}' |
        Set-Content (Join-Path $root $file)
}

$lock = Get-Content server/mods.lock.json -Raw | ConvertFrom-Json
$versionId = "fabric-loader-$($lock.minecraft.loaderVersion)-$($lock.minecraft.version)"
foreach ($attempt in 1..2) {
    '' | & ./MCBot-Cobblemon-Setup.exe
    if ($LASTEXITCODE -ne 0) { throw "Installer failed on attempt $attempt" }
    foreach ($file in $launcherFiles) {
        $launcher = Get-Content (Join-Path $root $file) -Raw | ConvertFrom-Json
        $profile = $launcher.profiles.'mcbot-cobblemon'
        if ($launcher.profiles.vanilla.name -ne 'Keep me' -or !$launcher.settings.keep -or
            $profile.lastVersionId -ne $versionId -or $profile.name -ne 'Cobblemon Server') {
            throw "Unexpected launcher data in $file"
        }
    }

    $fabric = Get-Content (Join-Path $root "versions/$versionId/$versionId.json") -Raw | ConvertFrom-Json
    if ($fabric.id -ne $versionId -or $fabric.inheritsFrom -ne $lock.minecraft.version) {
        throw 'Incorrect Fabric version metadata'
    }
    foreach ($mod in $lock.mods) {
        $hash = Get-FileHash (Join-Path $profile.gameDir "mods/$($mod.file)") -Algorithm SHA256
        if ($hash.Hash -ne $mod.sha256) { throw "Incorrect mod $($mod.file)" }
    }

    $path = Join-Path $profile.gameDir 'servers.dat'
    $bytes = [IO.File]::ReadAllBytes($path)
    $length = $env:MINECRAFT_SERVER_ADDRESS.Length.ToString('X4')
    $address = [Convert]::ToHexString([Text.Encoding]::ASCII.GetBytes($env:MINECRAFT_SERVER_ADDRESS))
    $expected = "0A0000090007736572766572730A000000010800046E616D650010436F62626C656D6F6E205365727665720800026970${length}${address}0000"
    if ([Convert]::ToHexString($bytes) -ne $expected) { throw 'Incorrect saved server NBT' }

    if ($attempt -eq 1) {
        # A timestamp comparison detects a rewrite even when the bytes are identical.
        [IO.File]::SetLastWriteTimeUtc($path, [DateTime]::UnixEpoch.AddDays(365 * 40))
        $savedAt = [IO.File]::GetLastWriteTimeUtc($path)
    } elseif ([IO.File]::GetLastWriteTimeUtc($path) -ne $savedAt) {
        throw 'Reinstall rewrote the saved server list'
    }
}
