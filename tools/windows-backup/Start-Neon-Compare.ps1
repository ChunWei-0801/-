[CmdletBinding()]
param([switch]$CheckOnly)

# Import only the tested private ACL/native argv helpers, without running backup.
$compareCheckOnlyRequested = [bool]$CheckOnly
. (Join-Path $PSScriptRoot 'Start-Backup.ps1') -HelpersOnly
$CheckOnly = $compareCheckOnlyRequested
$stage = 'prerequisites'
$sourceUrl = $null
$targetUrl = $null
$sourceSecret = $null
$targetSecret = $null
$payload = $null
$reportDirectory = $null
$success = $false
$comparisonDifferent = $false

function Read-SafeCompareReport([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text) -or $Text.Length -gt 16384) { Stop-Safely 'RUNNER_RESULT_INVALID' }
    try { $raw = $Text | ConvertFrom-Json } catch { Stop-Safely 'RUNNER_RESULT_INVALID' }
    if ($null -eq $raw -or $raw -is [array] -or $raw -isnot [pscustomobject]) { Stop-Safely 'RUNNER_RESULT_INVALID' }
    $names = @($raw.PSObject.Properties | ForEach-Object { $_.Name })
    if ('schemaVersion' -notin $names -or ($raw.schemaVersion -isnot [int] -and $raw.schemaVersion -isnot [long]) -or $raw.schemaVersion -ne 1 -or
        'status' -notin $names -or $raw.status -isnot [string] -or $raw.status -notin @('verified', 'different', 'failed')) { Stop-Safely 'RUNNER_RESULT_INVALID' }
    $result = [ordered]@{schemaVersion=1;status=[string]$raw.status;stage='report';code='OPERATION_FAILED'}
    $booleans = @('match', 'dataMatched', 'schemaMatched', 'sequenceMatched', 'readOnly', 'sourceMaintenanceObserved')
    foreach ($field in $booleans) {
        if ($field -notin $names -or $raw.$field -isnot [bool]) { Stop-Safely 'RUNNER_RESULT_INVALID' }
        $result[$field] = [bool]$raw.$field
    }
    $stages = @('input', 'prerequisites', 'report-storage', 'source-maintenance', 'source-connect', 'target-connect',
        'data-compare', 'schema-compare', 'sequence-compare', 'source-maintenance-final', 'report', 'complete')
    $codes = @('OK', 'DATABASES_DIFFER', 'INPUT_INVALID', 'INPUT_TOO_LARGE', 'SOURCE_URL_INVALID',
        'SOURCE_OPTIONS_UNSUPPORTED', 'TARGET_URL_INVALID', 'TARGET_OPTIONS_UNSUPPORTED', 'TARGET_POOLER_UNSUPPORTED',
        'SOURCE_MAINTENANCE_REQUIRED', 'CLIENT_VERSION_UNSUPPORTED', 'SOURCE_VERSION_UNSUPPORTED',
        'TARGET_VERSION_UNSUPPORTED', 'READ_ONLY_REQUIRED', 'VAULT_UNSAFE', 'RESULT_ALREADY_EXISTS',
        'OPERATION_FAILED', 'REPORT_WRITE_FAILED', 'PREREQUISITES_FAILED')
    if ('stage' -in $names -and $raw.stage -is [string] -and $raw.stage -in $stages) { $result.stage = $raw.stage }
    if ('code' -in $names -and $raw.code -is [string] -and $raw.code -in $codes) { $result.code = $raw.code }
    $integers = @('sourceMajor', 'targetMajor', 'clientMajor', 'sourceTables', 'sourceRows', 'sourcePhotoBlobs',
        'sourcePhotoBytes', 'targetTables', 'targetRows', 'targetPhotoBlobs', 'targetPhotoBytes')
    foreach ($field in $integers) {
        if ($field -in $names) {
            if (($raw.$field -isnot [int] -and $raw.$field -isnot [long]) -or $raw.$field -lt 0) { Stop-Safely 'RUNNER_RESULT_INVALID' }
            $result[$field] = $raw.$field
        }
    }
    foreach ($field in @('sourceInventorySHA256', 'targetInventorySHA256', 'sourceIdentitySHA256', 'targetIdentitySHA256')) {
        if ($field -in $names) {
            if ($raw.$field -isnot [string] -or $raw.$field -cnotmatch '\A[a-f0-9]{64}\z') { Stop-Safely 'RUNNER_RESULT_INVALID' }
            $result[$field] = $raw.$field
        }
    }
    if ('comparedAtUtc' -in $names) {
        $stamp = $raw.comparedAtUtc
        if ($stamp -is [DateTime] -or $stamp -is [DateTimeOffset]) {
            $stamp = $stamp.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffffff'Z'", [Globalization.CultureInfo]::InvariantCulture)
        }
        if ($stamp -isnot [string] -or $stamp -cnotmatch '\A\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)\z') { Stop-Safely 'RUNNER_RESULT_INVALID' }
        $result.comparedAtUtc = $stamp
    }
    if ($result.status -eq 'failed') {
        if ($result.code -in @('OK', 'DATABASES_DIFFER') -or $result.match) { Stop-Safely 'RUNNER_RESULT_INVALID' }
    } else {
        foreach ($field in ($integers + @('sourceInventorySHA256', 'targetInventorySHA256', 'sourceIdentitySHA256', 'targetIdentitySHA256', 'comparedAtUtc'))) {
            if (-not $result.Contains($field)) { Stop-Safely 'RUNNER_RESULT_INVALID' }
        }
        if ($result.stage -ne 'complete' -or $result.sourceMajor -ne 18 -or $result.targetMajor -ne 18 -or
            $result.clientMajor -ne 18 -or $result.sourceTables -lt 1 -or $result.targetTables -lt 1 -or
            -not $result.readOnly -or -not $result.sourceMaintenanceObserved) { Stop-Safely 'RUNNER_RESULT_INVALID' }
        if ($result.sourceIdentitySHA256 -ceq $result.targetIdentitySHA256) { Stop-Safely 'RUNNER_RESULT_INVALID' }
        $allMatched = $result.dataMatched -and $result.schemaMatched -and $result.sequenceMatched
        if ($result.status -eq 'verified') {
            if ($result.code -ne 'OK' -or -not $result.match -or -not $allMatched -or
                $result.sourceInventorySHA256 -cne $result.targetInventorySHA256) { Stop-Safely 'RUNNER_RESULT_INVALID' }
            foreach ($suffix in @('Tables', 'Rows', 'PhotoBlobs', 'PhotoBytes')) {
                if ($result[('source' + $suffix)] -ne $result[('target' + $suffix)]) { Stop-Safely 'RUNNER_RESULT_INVALID' }
            }
        } elseif ($result.code -ne 'DATABASES_DIFFER' -or $result.match -or $allMatched -or
            $result.sourceInventorySHA256 -ceq $result.targetInventorySHA256) { Stop-Safely 'RUNNER_RESULT_INVALID' }
    }
    return [pscustomobject]$result
}

function Assert-CompareRunnerOutcome($Report, [int]$ExitCode, [string]$ReportDirectory) {
    $expectedExit = if ($Report.status -eq 'verified') { 0 } elseif ($Report.status -eq 'different') { 2 } else { 1 }
    if ($ExitCode -ne $expectedExit) { Stop-Safely 'RUNNER_EXIT_FAILED' }
    if ($Report.status -eq 'failed') {
        # Input and maintenance failures can happen before a container report exists.
        $safePath = Join-Path $ReportDirectory 'comparison.json'
        [IO.File]::WriteAllText($safePath, ($Report | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
        Assert-PrivateFiles $ReportDirectory
        Stop-Safely $Report.code
    }
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

    $stage = 'image-build'
    $core = Join-Path $PSScriptRoot 'backup_restore.py'
    if (-not [IO.File]::Exists($core)) { $core = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\backend\tools\backup_restore.py')) }
    if (-not [IO.File]::Exists($core)) { Stop-Safely 'PACKAGE_INCOMPLETE' }
    $buildContext = Join-Path ([IO.Path]::GetTempPath()) ('fambudget-neon-compare-build-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($buildContext)
    foreach ($file in @('windows_backup.py', 'neon_restore.py', 'neon_compare.py', 'Neon-Compare.Dockerfile')) {
        $from = Join-Path $PSScriptRoot $file
        if (-not [IO.File]::Exists($from)) { Stop-Safely 'PACKAGE_INCOMPLETE' }
        $to = if ($file -eq 'Neon-Compare.Dockerfile') { 'Dockerfile' } else { $file }
        Copy-Item -LiteralPath $from -Destination (Join-Path $buildContext $to)
    }
    Copy-Item -LiteralPath $core -Destination (Join-Path $buildContext 'backup_restore.py')
    try {
        & $script:DockerExecutable --context $script:DockerContext build --tag 'fambudget-neon-compare:18' $buildContext
        if ($LASTEXITCODE -ne 0) { Stop-Safely 'IMAGE_BUILD_FAILED' }
    } finally { Remove-BuildContext }

    $stage = 'source-input'
    Write-Host '本工具只做唯讀比對，不新增、刪除或還原資料，也不切換網站。'
    Write-Host '網站須先啟用維護模式；未確認維護狀態時，工具會停止。'
    Write-Host '來源網址：Render「Connect → External」的完整 Database URL。'
    $sourceSecret = Read-Host 'Render External Database URL' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sourceSecret)
    try { $sourceUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ([string]::IsNullOrWhiteSpace($sourceUrl)) { Stop-Safely 'INPUT_CANCELLED' }
    $uri = $null
    if (-not [Uri]::TryCreate($sourceUrl.Trim(), [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -notin @('postgres', 'postgresql') -or [string]::IsNullOrEmpty($uri.UserInfo) -or
        $uri.Host -notmatch '^dpg-[a-z0-9-]+\.[a-z0-9-]+-postgres\.render\.com$') { Stop-Safely 'EXTERNAL_URL_REQUIRED' }

    $stage = 'target-input'
    Write-Host '目標網址：Neon Connect 的直接 PostgreSQL URL，Connection pooling 關閉。'
    Write-Host '兩個網址都只在本機隱藏輸入，不貼聊天或存成檔案。'
    $targetSecret = Read-Host 'Neon direct Database URL' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($targetSecret)
    try { $targetUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ([string]::IsNullOrWhiteSpace($targetUrl)) { Stop-Safely 'INPUT_CANCELLED' }
    $uri = $null
    if (-not [Uri]::TryCreate($targetUrl.Trim(), [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -notin @('postgres', 'postgresql') -or $uri.Host -notmatch '\.neon\.tech\z' -or
        $uri.Host -match '-pooler\.' -or [string]::IsNullOrEmpty($uri.UserInfo)) { Stop-Safely 'NEON_DIRECT_URL_REQUIRED' }
    $payload = @{sourceUrl=$sourceUrl.Trim();targetUrl=$targetUrl.Trim()} | ConvertTo-Json -Compress
    $sourceUrl = $null
    $targetUrl = $null
    $uri = $null

    $stage = 'private-storage'
    $runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
    $containerName = 'fambudget-neon-compare-' + $runId.ToLowerInvariant()
    $volumeName = $containerName + '-private'
    $reportDirectory = Join-Path (Join-Path $env:USERPROFILE 'FamBudgetMigrationComparisons') $runId
    Set-PrivateDirectory $reportDirectory
    [void](Invoke-DockerChecked -Arguments @('volume', 'create', '--label', 'app=fambudget-neon-compare', '--label', ('run=' + $runId), $volumeName) -Code 'VOLUME_CREATE_FAILED')
    [void](Invoke-DockerChecked -Arguments @('create', '--init', '--name', $containerName,
        '--label', 'app=fambudget-neon-compare', '--label', ('run=' + $runId),
        '--mount', ('type=volume,source=' + $volumeName + ',target=/vault'), 'fambudget-neon-compare:18') -Code 'CONTAINER_CREATE_FAILED')
    [void](Invoke-DockerChecked -Arguments @('start', $containerName) -Code 'CONTAINER_START_FAILED')
    [void](Invoke-DockerChecked -Arguments @('exec', $containerName, 'mkdir', '-m', '700', '-p', '/vault/result') -Code 'PRIVATE_STORAGE_FAILED')

    $stage = 'comparison'
    Write-Host '正在確認來源維護模式，唯讀比對資料、照片、結構及流水號。'
    $run = Invoke-Docker -Arguments @('exec', '-i', $containerName, 'python3', '/app/neon_compare.py') -InputText $payload
    $payload = $null
    $sourceSecret.Dispose();$sourceSecret=$null
    $targetSecret.Dispose();$targetSecret=$null
    $report = Read-SafeCompareReport $run.Output
    $stage = $report.stage
    Assert-CompareRunnerOutcome $report $run.ExitCode $reportDirectory
    $stage = 'report-export'
    $hash = Invoke-DockerChecked -Arguments @('exec', $containerName, 'sha256sum', '/vault/result/comparison.json') -Code 'REPORT_EXPORT_FAILED'
    if ($hash -cnotmatch '\A([a-f0-9]{64})  /vault/result/comparison\.json\z') { Stop-Safely 'REPORT_EXPORT_FAILED' }
    $expectedHash = $Matches[1]
    $reportPath = Join-Path $reportDirectory 'comparison.json'
    [void](Invoke-DockerChecked -Arguments @('cp', ($containerName + ':/vault/result/comparison.json'), $reportPath) -Code 'REPORT_EXPORT_FAILED')
    Assert-PrivateFiles $reportDirectory
    if ((Get-FileHash -LiteralPath $reportPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { Stop-Safely 'REPORT_HASH_MISMATCH' }
    $saved = Read-SafeCompareReport (Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8)
    if (($saved | ConvertTo-Json -Compress) -cne ($report | ConvertTo-Json -Compress)) { Stop-Safely 'REPORT_HASH_MISMATCH' }
    if ($report.status -eq 'different') {
        $comparisonDifferent = $true
        Write-Host '比對已完成：來源與目標有差異，尚不可切換網站。' -ForegroundColor Yellow
    } else {
        $success = $true
        Write-Host '完成：來源與目標的資料、照片、結構及流水號一致。'
    }
    Write-Host ('來源：資料表 ' + $report.sourceTables + '；資料列 ' + $report.sourceRows + '；照片 ' + $report.sourcePhotoBlobs)
    Write-Host ('目標：資料表 ' + $report.targetTables + '；資料列 ' + $report.targetRows + '；照片 ' + $report.targetPhotoBlobs)
    Write-Host ('安全比對報告：' + $reportPath)
    Write-Host '此工具不會切換網站；請提供比對報告，再安排後續步驟。'
} catch {
    $code='UNEXPECTED_LOCAL_FAILURE'
    if ($_.Exception.Data.Contains('FamBudgetSafeCode')) { $code=[string]$_.Exception.Data['FamBudgetSafeCode'] }
    Write-Host ('尚未完成（' + $stage + '／' + $code + '）。') -ForegroundColor Yellow
    Write-Host '請只回報階段與代碼，網址和密碼保持隱藏。'
} finally {
    $sourceUrl=$null
    $targetUrl=$null
    $payload=$null
    if ($null -ne $sourceSecret) { $sourceSecret.Dispose();$sourceSecret=$null }
    if ($null -ne $targetSecret) { $targetSecret.Dispose();$targetSecret=$null }
    Remove-BuildContext
    if ($containerName) {
        try { $stopResult=Invoke-Docker -Arguments @('stop', '--time', '15', $containerName)
            if ($stopResult.ExitCode -ne 0) { Write-Host '本次比對容器尚未確認停止，請在 Docker Desktop 查看。' }
        } catch { Write-Host '本次比對容器尚未確認停止，請在 Docker Desktop 查看。' }
    }
    if ($reportDirectory) { Write-Host ('本次比對報告資料夾：' + $reportDirectory) }
    if ($volumeName) { Write-Host ('保留的本機私人 volume：' + $volumeName) }
}
if ($success) { exit 0 }
if ($comparisonDifferent) { exit 2 }
exit 1
