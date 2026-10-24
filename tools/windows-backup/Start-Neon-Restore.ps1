[CmdletBinding()]
param([switch]$CheckOnly)

# Reuse the tested native argv, local-only Docker and private ACL helpers.
$neonCheckOnlyRequested = [bool]$CheckOnly
. (Join-Path $PSScriptRoot 'Start-Backup.ps1') -HelpersOnly
$CheckOnly = $neonCheckOnlyRequested
$stage = 'prerequisites'
$targetUrl = $null
$reportDirectory = $null
$payload = $null
$secret = $null
$success = $false
$neonKeyCopied = $false

function Read-SafeNeonReport([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text) -or $Text.Length -gt 16384) { Stop-Safely 'RUNNER_RESULT_INVALID' }
    try { $raw = $Text | ConvertFrom-Json } catch { Stop-Safely 'RUNNER_RESULT_INVALID' }
    if ($null -eq $raw -or $raw -is [array] -or $raw -isnot [pscustomobject]) { Stop-Safely 'RUNNER_RESULT_INVALID' }
    $names = @($raw.PSObject.Properties | ForEach-Object { $_.Name })
    if ('schemaVersion' -notin $names -or ($raw.schemaVersion -isnot [int] -and $raw.schemaVersion -isnot [long]) -or $raw.schemaVersion -ne 1 -or
        'status' -notin $names -or $raw.status -isnot [string] -or $raw.status -notin @('verified', 'failed')) { Stop-Safely 'RUNNER_RESULT_INVALID' }
    foreach ($field in @('restoreVerified', 'plaintextRemoved')) {
        if ($field -notin $names -or $raw.$field -isnot [bool]) { Stop-Safely 'RUNNER_RESULT_INVALID' }
    }
    $result = [ordered]@{schemaVersion=1;status=[string]$raw.status;stage='report';code='OPERATION_FAILED';restoreVerified=[bool]$raw.restoreVerified;plaintextRemoved=[bool]$raw.plaintextRemoved}
    $stages = @('input', 'prerequisites', 'input-files', 'backup-authentication', 'backup-validation',
        'target-connection', 'target-empty-check', 'target-restore', 'cleanup', 'report', 'complete')
    $codes = @('OK', 'INPUT_INVALID', 'INPUT_TOO_LARGE', 'TARGET_URL_INVALID', 'TARGET_OPTIONS_UNSUPPORTED',
        'TARGET_POOLER_UNSUPPORTED', 'TARGET_VERSION_UNSUPPORTED', 'CLIENT_VERSION_UNSUPPORTED',
        'INPUT_FILES_INVALID', 'VAULT_UNSAFE', 'RESULT_ALREADY_EXISTS', 'BACKUP_INVALID',
        'SOURCE_IDENTITY_MISMATCH', 'BACKUP_TOO_OLD', 'BACKUP_TIME_INVALID', 'BACKUP_SCHEMA_UNSUPPORTED',
        'TARGET_NOT_EMPTY', 'RESTORE_NOT_VERIFIED', 'OPERATION_FAILED', 'PRIVATE_CLEANUP_FAILED', 'REPORT_WRITE_FAILED')
    if ('stage' -in $names -and $raw.stage -is [string] -and $raw.stage -in $stages) { $result.stage = $raw.stage }
    if ('code' -in $names -and $raw.code -is [string] -and $raw.code -in $codes) { $result.code = $raw.code }
    foreach ($field in @('targetMajor', 'clientMajor', 'tables', 'rows', 'photoBlobs', 'photoBytes')) {
        if ($field -in $names) {
            if (($raw.$field -isnot [int] -and $raw.$field -isnot [long]) -or $raw.$field -lt 0) { Stop-Safely 'RUNNER_RESULT_INVALID' }
            $result[$field] = $raw.$field
        }
    }
    if ('archiveSHA256' -in $names) {
        if ($raw.archiveSHA256 -isnot [string] -or $raw.archiveSHA256 -cnotmatch '\A[a-f0-9]{64}\z') { Stop-Safely 'RUNNER_RESULT_INVALID' }
        $result.archiveSHA256 = $raw.archiveSHA256
    }
    if ('backupCreatedAt' -in $names) {
        $stamp = $raw.backupCreatedAt
        if ($stamp -is [DateTime] -or $stamp -is [DateTimeOffset]) {
            $stamp = $stamp.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffffff'Z'", [Globalization.CultureInfo]::InvariantCulture)
        }
        if ($stamp -isnot [string] -or $stamp -cnotmatch '\A\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)\z') { Stop-Safely 'RUNNER_RESULT_INVALID' }
        $result.backupCreatedAt = $stamp
    }
    if ($result.status -eq 'failed' -and $result.code -eq 'OK') { Stop-Safely 'RUNNER_RESULT_INVALID' }
    if ($result.status -eq 'verified') {
        foreach ($field in @('targetMajor', 'clientMajor', 'tables', 'rows', 'photoBlobs', 'photoBytes', 'archiveSHA256', 'backupCreatedAt')) {
            if (-not $result.Contains($field)) { Stop-Safely 'RUNNER_RESULT_INVALID' }
        }
        if (-not $result.restoreVerified -or -not $result.plaintextRemoved -or $result.code -ne 'OK' -or
            $result.stage -ne 'complete' -or $result.targetMajor -ne 18 -or $result.clientMajor -ne 18 -or $result.tables -lt 1) {
            Stop-Safely 'RUNNER_RESULT_INVALID'
        }
    }
    return [pscustomobject]$result
}

function Assert-NeonRunnerOutcome($Report, [int]$ExitCode, [string]$ReportDirectory) {
    if ($Report.status -eq 'verified' -and $ExitCode -ne 0) { Stop-Safely 'RUNNER_EXIT_FAILED' }
    if ($Report.status -eq 'failed') {
        # Early input/preflight failures have no container report. Preserve the
        # allowlisted stdout outcome rather than masking it with export failure.
        $safePath = Join-Path $ReportDirectory 'verification.json'
        [IO.File]::WriteAllText($safePath, ($Report | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
        Assert-PrivateFiles $ReportDirectory
        Stop-Safely $Report.code
    }
}

function Resolve-NeonBackupFiles([string]$Directory, [string]$KeyPath) {
    $directoryPath = [IO.Path]::GetFullPath($Directory.Trim().Trim('"'))
    $keyFile = [IO.Path]::GetFullPath($KeyPath.Trim().Trim('"'))
    Assert-PrivatePath $directoryPath
    Assert-PrivatePath ([IO.Path]::GetDirectoryName($keyFile))
    if (-not [IO.Directory]::Exists($directoryPath) -or -not [IO.File]::Exists($keyFile)) { Stop-Safely 'BACKUP_FILES_MISSING' }
    Assert-PrivateFiles $directoryPath
    Assert-PrivateFiles ([IO.Path]::GetDirectoryName($keyFile))
    $key = Get-Item -LiteralPath $keyFile
    if (($key.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $key.Length -lt 32 -or $key.Length -gt 4096) { Stop-Safely 'BACKUP_FILES_INVALID' }
    $manifests = @(Get-ChildItem -LiteralPath $directoryPath -File -Filter 'postgresql-*.json')
    if ($manifests.Count -ne 1 -or $manifests[0].Length -gt 2097152) { Stop-Safely 'BACKUP_MANIFEST_REQUIRED' }
    try { $metadata = Get-Content -LiteralPath $manifests[0].FullName -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { Stop-Safely 'BACKUP_FILES_INVALID' }
    if ($metadata -isnot [pscustomobject] -or 'archive' -notin @($metadata.PSObject.Properties | ForEach-Object { $_.Name }) -or
        $metadata.archive -isnot [string] -or $metadata.archive -cnotmatch '\A[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.enc\z') { Stop-Safely 'BACKUP_FILES_INVALID' }
    $archive = Join-Path $directoryPath $metadata.archive
    if (-not [IO.File]::Exists($archive)) { Stop-Safely 'BACKUP_FILES_MISSING' }
    $archiveFile = Get-Item -LiteralPath $archive
    if ($archiveFile.Attributes -band [IO.FileAttributes]::ReparsePoint) { Stop-Safely 'BACKUP_FILES_INVALID' }
    return [pscustomobject]@{Manifest=$manifests[0].FullName;Archive=$archive;ArchiveName=$metadata.archive;Key=$keyFile}
}

try {
    if ($env:OS -ne 'Windows_NT') { Stop-Safely 'WINDOWS_REQUIRED' }
    $command = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($null -eq $command) { Stop-Safely 'DOCKER_NOT_INSTALLED' }
    $script:DockerExecutable = $command.Source
    $contextResult = Invoke-Docker -Arguments @('context', 'show')
    if ($contextResult.ExitCode -ne 0) { Stop-Safely 'DOCKER_CONTEXT_UNAVAILABLE' }
    $context = $contextResult.Output.Trim()
    if ($context -notmatch '^[A-Za-z0-9_.-]+$') { Stop-Safely 'DOCKER_CONTEXT_UNAVAILABLE' }
    $contextResult = Invoke-Docker -Arguments @('context', 'inspect', $context, '--format', '{{.Endpoints.docker.Host}}')
    if ($contextResult.ExitCode -ne 0 -or $contextResult.Output.Trim() -notmatch '^npipe:/{2,}\./pipe/[A-Za-z0-9_.-]+$') { Stop-Safely 'LOCAL_DOCKER_REQUIRED' }
    $script:DockerContext = $context
    if ((Invoke-DockerChecked -Arguments @('info', '--format', '{{.OSType}}') -Code 'DOCKER_NOT_RUNNING') -ne 'linux') { Stop-Safely 'DOCKER_LINUX_REQUIRED' }
    Write-Host '本機 Docker Desktop Linux 環境檢查通過。'
    if ($CheckOnly) { exit 0 }

    $stage = 'backup-files'
    Write-Host '本工具只還原到全新的空 Neon PostgreSQL 18 資料庫，不會切換 Render 網站。'
    $backupPath = Read-Host '本次加密備份資料夾路徑'
    $keyPath = Read-Host '本次獨立 backup.key 檔案的完整路徑'
    $inputFiles = Resolve-NeonBackupFiles $backupPath $keyPath

    $stage = 'image-build'
    $core = Join-Path $PSScriptRoot 'backup_restore.py'
    if (-not [IO.File]::Exists($core)) { $core = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\backend\tools\backup_restore.py')) }
    if (-not [IO.File]::Exists($core)) { Stop-Safely 'PACKAGE_INCOMPLETE' }
    $buildContext = Join-Path ([IO.Path]::GetTempPath()) ('fambudget-neon-build-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($buildContext)
    foreach ($file in @('windows_backup.py', 'neon_restore.py', 'Neon-Restore.Dockerfile')) {
        $from = Join-Path $PSScriptRoot $file
        if (-not [IO.File]::Exists($from)) { Stop-Safely 'PACKAGE_INCOMPLETE' }
        $to = if ($file -eq 'Neon-Restore.Dockerfile') { 'Dockerfile' } else { $file }
        Copy-Item -LiteralPath $from -Destination (Join-Path $buildContext $to)
    }
    Copy-Item -LiteralPath $core -Destination (Join-Path $buildContext 'backup_restore.py')
    try {
        & $script:DockerExecutable --context $script:DockerContext build --tag 'fambudget-neon-restore:18' $buildContext
        if ($LASTEXITCODE -ne 0) { Stop-Safely 'IMAGE_BUILD_FAILED' }
    } finally { Remove-BuildContext }

    $stage = 'target-input'
    Write-Host '在 Neon 按 Connect，關閉 Connection pooling，複製完整 PostgreSQL URL。'
    Write-Host '請只在下方隱藏輸入；網址不放入命令列、環境變數、聊天或檔案。'
    $secret = Read-Host 'Neon direct Database URL' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { $targetUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ([string]::IsNullOrWhiteSpace($targetUrl)) { Stop-Safely 'INPUT_CANCELLED' }
    $uri = $null
    if (-not [Uri]::TryCreate($targetUrl.Trim(), [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -notin @('postgres', 'postgresql') -or $uri.Host -notmatch '\.neon\.tech\z' -or
        $uri.Host -match '-pooler\.' -or [string]::IsNullOrEmpty($uri.UserInfo)) { Stop-Safely 'NEON_DIRECT_URL_REQUIRED' }
    $payload = @{targetUrl=$targetUrl.Trim()} | ConvertTo-Json -Compress
    $targetUrl = $null
    $uri = $null

    $stage = 'private-storage'
    $runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
    $containerName = 'fambudget-neon-' + $runId.ToLowerInvariant()
    $volumeName = $containerName + '-private'
    $reportDirectory = Join-Path (Join-Path $env:USERPROFILE 'FamBudgetMigrationReports') $runId
    Set-PrivateDirectory $reportDirectory
    [void](Invoke-DockerChecked -Arguments @('volume', 'create', '--label', 'app=fambudget-neon-restore', '--label', ('run=' + $runId), $volumeName) -Code 'VOLUME_CREATE_FAILED')
    [void](Invoke-DockerChecked -Arguments @('create', '--init', '--name', $containerName,
        '--label', 'app=fambudget-neon-restore', '--label', ('run=' + $runId),
        '--mount', ('type=volume,source=' + $volumeName + ',target=/vault'), 'fambudget-neon-restore:18') -Code 'CONTAINER_CREATE_FAILED')
    [void](Invoke-DockerChecked -Arguments @('start', $containerName) -Code 'CONTAINER_START_FAILED')
    [void](Invoke-DockerChecked -Arguments @('exec', $containerName, 'mkdir', '-m', '700', '-p', '/vault/input', '/vault/key', '/vault/result') -Code 'PRIVATE_INPUT_FAILED')
    [void](Invoke-DockerChecked -Arguments @('cp', $inputFiles.Manifest, ($containerName + ':/vault/input/backup.json')) -Code 'PRIVATE_INPUT_FAILED')
    [void](Invoke-DockerChecked -Arguments @('cp', $inputFiles.Archive, ($containerName + ':/vault/input/' + $inputFiles.ArchiveName)) -Code 'PRIVATE_INPUT_FAILED')
    [void](Invoke-DockerChecked -Arguments @('cp', $inputFiles.Key, ($containerName + ':/vault/key/backup.key')) -Code 'PRIVATE_INPUT_FAILED')
    $neonKeyCopied = $true
    [void](Invoke-DockerChecked -Arguments @('exec', $containerName, 'chmod', '600', '/vault/input/backup.json', ('/vault/input/' + $inputFiles.ArchiveName), '/vault/key/backup.key') -Code 'PRIVATE_INPUT_FAILED')

    $stage = 'target-restore'
    Write-Host '正在驗證備份、版本及空資料庫，再還原並比對資料與照片雜湊。'
    $run = Invoke-Docker -Arguments @('exec', '-i', $containerName, 'python3', '/app/neon_restore.py') -InputText $payload
    $payload = $null
    $secret.Dispose()
    $secret = $null
    $report = Read-SafeNeonReport $run.Output
    $stage = $report.stage
    Assert-NeonRunnerOutcome $report $run.ExitCode $reportDirectory
    $stage = 'report-export'
    $hash = Invoke-DockerChecked -Arguments @('exec', $containerName, 'sha256sum', '/vault/result/verification.json') -Code 'REPORT_EXPORT_FAILED'
    if ($hash -cnotmatch '\A([a-f0-9]{64})  /vault/result/verification\.json\z') { Stop-Safely 'REPORT_EXPORT_FAILED' }
    $expectedHash = $Matches[1]
    $reportPath = Join-Path $reportDirectory 'verification.json'
    [void](Invoke-DockerChecked -Arguments @('cp', ($containerName + ':/vault/result/verification.json'), $reportPath) -Code 'REPORT_EXPORT_FAILED')
    Assert-PrivateFiles $reportDirectory
    if ((Get-FileHash -LiteralPath $reportPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { Stop-Safely 'REPORT_HASH_MISMATCH' }
    $saved = Read-SafeNeonReport (Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8)
    if (($saved | ConvertTo-Json -Compress) -cne ($report | ConvertTo-Json -Compress)) { Stop-Safely 'REPORT_HASH_MISMATCH' }
    if ($run.ExitCode -ne 0 -or $report.status -ne 'verified') { $stage=$report.stage;Stop-Safely $report.code }
    $success = $true
    Write-Host ('完成：Neon 還原與雜湊核對通過。資料表：' + $report.tables + '；資料列：' + $report.rows + '；照片：' + $report.photoBlobs)
    Write-Host ('安全驗證報告：' + $reportPath)
    Write-Host '目前只完成新資料庫還原；原網站仍使用 Render。網站切換與新資料核對尚未完成。'
} catch {
    $code='UNEXPECTED_LOCAL_FAILURE'
    if ($_.Exception.Data.Contains('FamBudgetSafeCode')) { $code=[string]$_.Exception.Data['FamBudgetSafeCode'] }
    Write-Host ('尚未完成（' + $stage + '／' + $code + '）。') -ForegroundColor Yellow
    Write-Host '請只回報階段與代碼，保留原備份、金鑰與本次資料庫；不要把連線網址貼到聊天。'
} finally {
    $targetUrl=$null
    $payload=$null
    if ($null -ne $secret) { $secret.Dispose();$secret=$null }
    Remove-BuildContext
    if ($containerName) {
        if ($neonKeyCopied) {
            try { $erase = Invoke-Docker -Arguments @('exec', $containerName, 'rm', '-f', '--', '/vault/key/backup.key')
                if ($erase.ExitCode -ne 0) { Write-Host '本次容器內的金鑰副本尚未確認清除，請保持 volume 私人。' }
            } catch { Write-Host '本次容器內的金鑰副本尚未確認清除，請保持 volume 私人。' }
        }
        try { $stopResult=Invoke-Docker -Arguments @('stop', '--time', '15', $containerName)
            if ($stopResult.ExitCode -ne 0) { Write-Host '本次還原容器尚未確認停止，請在 Docker Desktop 查看。' }
        } catch { Write-Host '本次還原容器尚未確認停止，請在 Docker Desktop 查看。' }
    }
    if ($reportDirectory) { Write-Host ('本次驗證報告資料夾：' + $reportDirectory) }
    if ($volumeName) {
        Write-Host ('保留的本機私人 volume：' + $volumeName)
        Write-Host '若強制中斷，volume 可能含私人金鑰或明文暫存，請保持私人。原備份、來源資料庫與其他容器均未修改。'
    }
}
if ($success) { exit 0 }
exit 1
