[CmdletBinding()]
param([switch]$CheckOnly, [switch]$HelpersOnly)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:DockerExecutable = $null
$script:DockerContext = $null
$stage = 'prerequisites'
$containerName = $null
$volumeName = $null
$sourceUrl = $null
$payload = $null
$secret = $null
$success = $false
$copied = $false
$buildContext = $null
$runnerReport = $null

function Stop-Safely([string]$Code) {
    $exception = New-Object System.InvalidOperationException($Code)
    $exception.Data['FamBudgetSafeCode'] = $Code
    throw $exception
}

function ConvertTo-NativeArgument([string]$Value) {
    # ProcessStartInfo on Windows PowerShell 5.1 accepts one command line. No shell
    # is involved; quote according to the Windows native argv rules.
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Invoke-Docker {
    param([string[]]$Arguments, [string]$InputText = $null)
    $nativeArguments = @()
    if ($script:DockerContext) { $nativeArguments += @('--context', $script:DockerContext) }
    $nativeArguments += $Arguments
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $script:DockerExecutable
    $start.Arguments = (($nativeArguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.RedirectStandardInput = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    try {
        [void]$process.Start()
        $output = $process.StandardOutput.ReadToEndAsync()
        $errors = $process.StandardError.ReadToEndAsync()
        if ($null -ne $InputText) {
            $encoding = New-Object System.Text.UTF8Encoding($false)
            $bytes = $encoding.GetBytes($InputText + "`n")
            try {
                $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
                $process.StandardInput.BaseStream.Flush()
            } finally {
                [Array]::Clear($bytes, 0, $bytes.Length)
            }
        }
        $process.StandardInput.Close()
        $process.WaitForExit()
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $output.Result; ErrorOutput = $errors.Result }
    } finally {
        $process.Dispose()
    }
}

function Invoke-DockerChecked([string[]]$Arguments, [string]$Code) {
    $result = Invoke-Docker -Arguments $Arguments
    if ($result.ExitCode -ne 0) { Stop-Safely $Code }
    return $result.Output.Trim()
}

function Read-SafeRunnerReport([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text) -or $Text.Length -gt 16384) { Stop-Safely 'RUNNER_RESULT_INVALID' }
    try { $raw = $Text | ConvertFrom-Json }
    catch { Stop-Safely 'RUNNER_RESULT_INVALID' }
    if ($null -eq $raw -or $raw -is [array] -or $raw -isnot [pscustomobject]) { Stop-Safely 'RUNNER_RESULT_INVALID' }
    $properties = @($raw.PSObject.Properties | ForEach-Object { $_.Name })
    if ('status' -notin $properties -or $raw.status -notin @('verified', 'failed')) { Stop-Safely 'RUNNER_RESULT_INVALID' }
    $result = [ordered]@{ status = [string]$raw.status; stage = 'runner'; code = 'RUNNER_FAILED' }
    foreach ($field in @('verified', 'backupCompleted', 'productionBackupCompleted', 'restoreVerified', 'plaintextRemoved')) {
        if ($field -notin $properties -or $raw.$field -isnot [bool]) { Stop-Safely 'RUNNER_RESULT_INVALID' }
        $result[$field] = [bool]$raw.$field
    }
    $stages = @('input', 'prerequisites', 'source-connection', 'encrypted-backup', 'isolated-restore', 'cleanup', 'report')
    if ('stage' -in $properties -and $raw.stage -is [string] -and $raw.stage -in $stages) { $result.stage = $raw.stage }
    $codes = @('BACKUP_TOOL_MISSING', 'CLIENT_VERSION_UNKNOWN', 'CONTAINER_ROOT_REQUIRED', 'INPUT_INVALID',
        'INPUT_TOO_LARGE', 'LOCAL_PROCESS_FAILED', 'LOCAL_TOOL_MISSING', 'LOCAL_TOOL_UNAVAILABLE',
        'RESTORE_NOT_VERIFIED', 'SOURCE_DESTINATION_MISMATCH', 'SOURCE_OPTIONS_UNSUPPORTED',
        'SOURCE_VERSION_UNSUPPORTED', 'TLS_CA_MISSING', 'VAULT_NOT_EMPTY', 'VAULT_UNSAFE',
        'OPERATION_FAILED', 'PLAINTEXT_CLEANUP_FAILED', 'REPORT_WRITE_FAILED')
    if ('code' -in $properties -and $raw.code -is [string] -and $raw.code -in $codes) { $result.code = $raw.code }
    return [pscustomobject]$result
}

function Remove-BuildContext {
    if ($script:buildContext -and [IO.Directory]::Exists($script:buildContext)) {
        # This directory contains only three public code files copied by this
        # invocation. No source directory or credential is ever placed here.
        try {
            Remove-Item -LiteralPath $script:buildContext -Recurse -Force
            $script:buildContext = $null
        } catch { Write-Host '本次工具建置的公開程式暫存資料夾尚未清除；其中不含資料庫網址或資料。' }
    }
}

function Assert-PrivatePath([string]$Path) {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $item = New-Object IO.DirectoryInfo($fullPath)
    while ($null -ne $item) {
        if ([IO.Directory]::Exists((Join-Path $item.FullName '.git')) -or [IO.File]::Exists((Join-Path $item.FullName '.git'))) {
            Stop-Safely 'OUTPUT_INSIDE_GIT'
        }
        if ($item.Exists -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Stop-Safely 'OUTPUT_REPARSE_POINT'
        }
        $item = $item.Parent
    }
}

function Set-PrivateDirectory([string]$Path) {
    Assert-PrivatePath $Path
    [void][IO.Directory]::CreateDirectory($Path)
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($user)
    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    foreach ($sid in @($user, $system)) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, [Security.AccessControl.FileSystemRights]::FullControl,
            $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
    $actual = Get-Acl -LiteralPath $Path
    if (-not $actual.AreAccessRulesProtected) { Stop-Safely 'PRIVATE_ACL_FAILED' }
    foreach ($rule in $actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            $rule.IdentityReference.Value -notin @($user.Value, $system.Value)) {
            Stop-Safely 'PRIVATE_ACL_FAILED'
        }
    }
}

function Assert-PrivateFiles([string]$Path) {
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    foreach ($file in @(Get-ChildItem -LiteralPath $Path -File -Recurse)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { Stop-Safely 'OUTPUT_REPARSE_POINT' }
        $acl = Get-Acl -LiteralPath $file.FullName
        foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
                $rule.IdentityReference.Value -notin @($user, 'S-1-5-18')) { Stop-Safely 'PRIVATE_ACL_FAILED' }
        }
    }
}

# Internal shared-helper import performs no Docker or database operation.
if ($HelpersOnly) { return }

try {
    if ($env:OS -ne 'Windows_NT') { Stop-Safely 'WINDOWS_REQUIRED' }
    $command = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($null -eq $command) { Stop-Safely 'DOCKER_NOT_INSTALLED' }
    $script:DockerExecutable = $command.Source
    # Pin every operation to a local named-pipe endpoint. An existing remote
    # Docker context must never receive a user's database credential.
    $contextResult = Invoke-Docker -Arguments @('context', 'show')
    if ($contextResult.ExitCode -ne 0) { Stop-Safely 'DOCKER_CONTEXT_UNAVAILABLE' }
    $context = $contextResult.Output.Trim()
    if ($context -notmatch '^[A-Za-z0-9_.-]+$') { Stop-Safely 'DOCKER_CONTEXT_UNAVAILABLE' }
    $contextResult = Invoke-Docker -Arguments @('context', 'inspect', $context, '--format', '{{.Endpoints.docker.Host}}')
    if ($contextResult.ExitCode -ne 0 -or $contextResult.Output.Trim() -notmatch '^npipe:/{2,}\./pipe/[A-Za-z0-9_.-]+$') {
        Stop-Safely 'LOCAL_DOCKER_REQUIRED'
    }
    $script:DockerContext = $context
    $type = Invoke-DockerChecked -Arguments @('info', '--format', '{{.OSType}}') -Code 'DOCKER_NOT_RUNNING'
    if ($type -ne 'linux') { Stop-Safely 'DOCKER_LINUX_REQUIRED' }
    Write-Host 'Docker Desktop 本機 Linux 環境檢查通過。'
    if ($CheckOnly) { exit 0 }

    $stage = 'image-build'
    foreach ($required in @('Dockerfile', 'windows_backup.py')) {
        if (-not [IO.File]::Exists((Join-Path $PSScriptRoot $required))) { Stop-Safely 'PACKAGE_INCOMPLETE' }
    }
    $backupCore = Join-Path $PSScriptRoot 'backup_restore.py'
    if (-not [IO.File]::Exists($backupCore)) {
        $backupCore = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\backend\tools\backup_restore.py'))
    }
    if (-not [IO.File]::Exists($backupCore)) { Stop-Safely 'PACKAGE_INCOMPLETE' }
    # Support both the distributed ZIP and a complete repository checkout,
    # without sending the repository, .env files or unrelated data to Docker.
    $buildContext = Join-Path ([IO.Path]::GetTempPath()) ('fambudget-backup-build-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($buildContext)
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Dockerfile') -Destination (Join-Path $buildContext 'Dockerfile')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows_backup.py') -Destination (Join-Path $buildContext 'windows_backup.py')
    Copy-Item -LiteralPath $backupCore -Destination (Join-Path $buildContext 'backup_restore.py')
    Write-Host '正在準備備份工具；首次需要下載映像與套件，請保持網路連線。'
    try {
        & $script:DockerExecutable --context $script:DockerContext build --tag 'fambudget-private-backup:18' $buildContext
        if ($LASTEXITCODE -ne 0) { Stop-Safely 'IMAGE_BUILD_FAILED' }
    } finally { Remove-BuildContext }

    $stage = 'private-storage'
    $runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
    $containerName = 'fambudget-backup-' + $runId.ToLowerInvariant()
    $volumeName = $containerName + '-private'
    $backupDirectory = Join-Path (Join-Path $env:USERPROFILE 'FamBudgetBackups') $runId
    $keyDirectory = Join-Path (Join-Path $env:USERPROFILE 'FamBudgetRecoveryKeys') $runId
    Set-PrivateDirectory $backupDirectory
    Set-PrivateDirectory $keyDirectory
    [void](Invoke-DockerChecked -Arguments @('volume', 'create', '--label', 'app=fambudget-private-backup',
        '--label', ('run=' + $runId), $volumeName) -Code 'VOLUME_CREATE_FAILED')
    [void](Invoke-DockerChecked -Arguments @('create', '--init', '--name', $containerName,
        '--label', 'app=fambudget-private-backup', '--label', ('run=' + $runId),
        '--mount', ('type=volume,source=' + $volumeName + ',target=/vault'),
        'fambudget-private-backup:18') -Code 'CONTAINER_CREATE_FAILED')
    [void](Invoke-DockerChecked -Arguments @('start', $containerName) -Code 'CONTAINER_START_FAILED')

    $stage = 'database-input'
    Write-Host ''
    Write-Host '請貼上 Render「Connect → External」的完整 Database URL。'
    Write-Host '輸入會隱藏，僅送往這台電腦的備份容器；請勿貼到聊天或截圖。'
    $secret = Read-Host 'External Database URL' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { $sourceUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ([string]::IsNullOrWhiteSpace($sourceUrl)) { Stop-Safely 'INPUT_CANCELLED' }
    $uri = $null
    if (-not [Uri]::TryCreate($sourceUrl.Trim(), [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -notin @('postgres', 'postgresql') -or [string]::IsNullOrEmpty($uri.UserInfo) -or
        $uri.Host -notmatch '^dpg-[a-z0-9-]+\.[a-z0-9-]+-postgres\.render\.com$') {
        Stop-Safely 'EXTERNAL_URL_REQUIRED'
    }
    $payload = @{ sourceUrl = $sourceUrl.Trim() } | ConvertTo-Json -Compress
    $sourceUrl = $null
    $uri = $null
    $stage = 'backup-and-restore'
    Write-Host '正在建立唯讀快照、加密備份並還原到全新的隔離資料庫。請保持 Docker 開啟。'
    $run = Invoke-Docker -Arguments @('exec', '-i', $containerName, 'python3', '/app/windows_backup.py') -InputText $payload
    $payload = $null
    $secret.Dispose()
    $secret = $null
    $runnerReport = Read-SafeRunnerReport $run.Output
    if ($runnerReport.status -eq 'failed' -and -not $runnerReport.backupCompleted) {
        $stage = $runnerReport.stage
        Stop-Safely $runnerReport.code
    }

    $stage = 'export-integrity'
    # Only hashes and safe generated filenames leave the private volume here.
    # URL, SQL, database rows and key bytes never enter stdout.
    $hashCode = @'
import hashlib,json,pathlib
def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()
root=pathlib.Path('/vault/export'); key=pathlib.Path('/vault/key/backup.key')
files=[]
for p in sorted(root.iterdir()):
    if p.is_symlink() or not p.is_file(): raise ValueError('unsafe export')
    files.append({'name':p.name,'sha256':digest(p),'bytes':p.stat().st_size})
if not files or key.is_symlink() or not key.is_file(): raise ValueError('incomplete export')
print(json.dumps({'files':files,'keySHA256':digest(key),'keyBytes':key.stat().st_size}))
'@
    $hashResult = Invoke-Docker -Arguments @('exec', $containerName, 'python3', '-c', $hashCode)
    if ($hashResult.ExitCode -ne 0) { Stop-Safely 'EXPORT_NOT_READY' }
    $hashes = $hashResult.Output | ConvertFrom-Json
    foreach ($file in @($hashes.files)) {
        if ($file.name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*\.(json|enc)$' -or
            $file.sha256 -notmatch '^[a-f0-9]{64}$' -or $file.bytes -lt 1) { Stop-Safely 'EXPORT_NOT_READY' }
    }
    if ($hashes.keySHA256 -notmatch '^[a-f0-9]{64}$' -or $hashes.keyBytes -lt 32) { Stop-Safely 'EXPORT_NOT_READY' }
    [void](Invoke-DockerChecked -Arguments @('cp', ($containerName + ':/vault/export/.'), $backupDirectory) -Code 'EXPORT_COPY_FAILED')
    $keyPath = Join-Path $keyDirectory 'backup.key'
    [void](Invoke-DockerChecked -Arguments @('cp', ($containerName + ':/vault/key/backup.key'), $keyPath) -Code 'KEY_COPY_FAILED')
    Assert-PrivateFiles $backupDirectory
    Assert-PrivateFiles $keyDirectory
    foreach ($file in @($hashes.files)) {
        $localFile = Join-Path $backupDirectory $file.name
        if (-not [IO.File]::Exists($localFile) -or (Get-Item -LiteralPath $localFile).Length -ne $file.bytes -or
            (Get-FileHash -LiteralPath $localFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) {
            Stop-Safely 'EXPORT_HASH_MISMATCH'
        }
    }
    if ((Get-Item -LiteralPath $keyPath).Length -ne $hashes.keyBytes -or
        (Get-FileHash -LiteralPath $keyPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hashes.keySHA256) {
        Stop-Safely 'KEY_HASH_MISMATCH'
    }
    $copied = $true
    $reportText = Get-Content -LiteralPath (Join-Path $backupDirectory 'verification.json') -Raw
    $report = Read-SafeRunnerReport $reportText
    if ($runnerReport.status -eq 'failed') {
        $stage = $runnerReport.stage
        Stop-Safely $runnerReport.code
    }
    if ($run.ExitCode -ne 0 -or $report.status -ne 'verified' -or -not $report.verified -or
        -not $report.backupCompleted -or -not $report.restoreVerified -or -not $report.plaintextRemoved -or
        -not $runnerReport.verified -or -not $runnerReport.restoreVerified -or -not $runnerReport.plaintextRemoved) {
        Stop-Safely 'RESTORE_NOT_VERIFIED'
    }
    $counts = $reportText | ConvertFrom-Json
    foreach ($field in @('tables', 'rows', 'photoBlobs')) {
        if ($field -notin @($counts.PSObject.Properties | ForEach-Object { $_.Name }) -or
            ($counts.$field -isnot [int] -and $counts.$field -isnot [long]) -or $counts.$field -lt 0) {
            Stop-Safely 'RUNNER_RESULT_INVALID'
        }
    }
    $success = $true
    Write-Host ''
    Write-Host '完成：資料庫已加密備份，隔離還原後的資料列與照片雜湊一致，本機匯出檔案雜湊也已核對。'
    Write-Host ('資料表：' + $counts.tables + '；資料列：' + $counts.rows + '；照片：' + $counts.photoBlobs)
    Write-Host ('加密備份：' + $backupDirectory)
    Write-Host ('獨立復原金鑰：' + $keyDirectory)
    Write-Host '請將兩個資料夾分開保存。這次尚未完成 Google Drive 異地上傳與下載驗證。'
} catch {
    $code = 'UNEXPECTED_LOCAL_FAILURE'
    if ($_.Exception.Data.Contains('FamBudgetSafeCode')) { $code = [string]$_.Exception.Data['FamBudgetSafeCode'] }
    Write-Host ''
    Write-Host ('尚未完成（' + $stage + '／' + $code + '）。不會把未完成的結果標示為成功。') -ForegroundColor Yellow
    if ($code -in @('DOCKER_NOT_INSTALLED', 'DOCKER_NOT_RUNNING', 'DOCKER_LINUX_REQUIRED', 'LOCAL_DOCKER_REQUIRED', 'DOCKER_CONTEXT_UNAVAILABLE')) {
        Write-Host '請安裝並開啟本機 Docker Desktop，切換到 Linux containers，再重新執行。'
        Write-Host '官方安裝說明：https://docs.docker.com/desktop/setup/install/windows-install/'
        Write-Host '不會自動安裝工具、切換你的 Docker context，或要求管理員權限。'
    } elseif ($code -eq 'EXTERNAL_URL_REQUIRED') {
        Write-Host '需要 Render Connect → External 的完整 postgres:// 或 postgresql:// 網址；請在本機輸入，不要貼到聊天。'
    } elseif ($code -eq 'INPUT_CANCELLED') {
        Write-Host '已停止，未取得資料庫網址。'
    } elseif ($copied) {
        Write-Host '已複製並核對現有加密檔案，但還原驗證未通過；請保留備份、金鑰及 Docker volume。'
        Write-Host ('備份資料夾：' + $backupDirectory)
        Write-Host ('金鑰資料夾：' + $keyDirectory)
    } else {
        Write-Host '請只回報上面的階段與代碼。不要貼資料庫網址、密碼或金鑰。'
    }
} finally {
    $sourceUrl = $null
    $payload = $null
    if ($null -ne $secret) { $secret.Dispose(); $secret = $null }
    Remove-BuildContext
    if ($containerName) {
        try {
            $stopResult = Invoke-Docker -Arguments @('stop', '--time', '15', $containerName)
            if ($stopResult.ExitCode -ne 0) { Write-Host '備份容器尚未確認停止，請在 Docker Desktop 查看此次容器。' }
        } catch { Write-Host '備份容器尚未確認停止，請在 Docker Desktop 查看此次容器。' }
    }
    if ($volumeName) {
        Write-Host ('保留的本機私人 volume：' + $volumeName)
        if (-not $success) {
            Write-Host '若曾強制中止，volume 可能仍含明文暫存資料；請保持私人，不要上傳或分享整個 volume。' -ForegroundColor Yellow
        }
        Write-Host '容器與 volume 不會自動刪除；其他容器、資料庫及原故障環境均未修改。'
    }
}
if ($success) { exit 0 }
exit 1
