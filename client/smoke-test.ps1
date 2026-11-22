$ErrorActionPreference = 'Stop'
$launcherFiles = @('launcher_profiles.json', 'launcher_profiles_microsoft_store.json')
$homeDir = Join-Path $env:RUNNER_TEMP 'mcbot-client-smoke'
if ($IsMacOS) {
    $env:HOME = $homeDir
    $rootPath = Join-Path $homeDir 'Library/Application Support/minecraft'
    $installer = './dist/Cobblemon Setup.app/Contents/MacOS/CobblemonSetup'
    $installerArgs = @('--cli')
    $launcherFiles = @('launcher_profiles.json')
} else {
    $env:APPDATA = $homeDir
    $rootPath = Join-Path $homeDir '.minecraft'
    $installer = './MCBot-Cobblemon-Setup.exe'
    $installerArgs = @()
}
$root = New-Item -ItemType Directory -Path $rootPath -Force
foreach ($file in $launcherFiles) {
    '{"profiles":{"vanilla":{"name":"Keep me"}},"settings":{"keep":true}}' |
        Set-Content (Join-Path $root $file)
}

$lock = Get-Content server/mods.lock.json -Raw | ConvertFrom-Json
$versionId = "fabric-loader-$($lock.minecraft.loaderVersion)-$($lock.minecraft.version)"
function Get-StringTag([string]$name, [string]$value) {
    $key = [Convert]::ToHexString([Text.Encoding]::ASCII.GetBytes($name))
    $text = [Convert]::ToHexString([Text.Encoding]::ASCII.GetBytes($value))
    return '08{0:X4}{1}{2:X4}{3}' -f $name.Length, $key, $value.Length, $text
}
$header = '0A0000090007736572766572730A'
$nameTag = Get-StringTag 'name' 'Cobblemon Server'
$ipTag = Get-StringTag 'ip' $env:MINECRAFT_SERVER_ADDRESS
$oldIpTag = Get-StringTag 'ip' '140.245.73.42:25565'
# Include a vanilla icon byte array and a separately named entry using the old address.
$iconTag = '07000469636F6E0000000400010203'
$other = (Get-StringTag 'name' 'Keep me') + $oldIpTag + '00'
$fresh = "${header}00000001${nameTag}${ipTag}0000"
$previous = "${header}00000002${oldIpTag}${iconTag}${nameTag}00${other}00"
$migrated = "${header}00000002${ipTag}${iconTag}${nameTag}00${other}00"
foreach ($attempt in 1..3) {
    '' | & $installer @installerArgs
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
    $expected = if ($attempt -eq 1) { $fresh } else { $migrated }
    if ([Convert]::ToHexString($bytes) -ne $expected) { throw 'Incorrect saved server NBT' }

    if ($attempt -eq 1) {
        [IO.File]::WriteAllBytes($path, [Convert]::FromHexString($previous))
    } elseif ($attempt -eq 2) {
        # A timestamp comparison detects a rewrite even when the bytes are identical.
        [IO.File]::SetLastWriteTimeUtc($path, [DateTime]::UnixEpoch.AddDays(365 * 40))
        $savedAt = [IO.File]::GetLastWriteTimeUtc($path)
    } elseif ([IO.File]::GetLastWriteTimeUtc($path) -ne $savedAt) {
        throw 'Reinstall rewrote the saved server list'
    }
}
