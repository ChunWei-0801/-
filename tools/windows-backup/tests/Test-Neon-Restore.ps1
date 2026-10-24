[CmdletBinding()]
param()
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$oldOS=$env:OS
try { $env:OS='helper-import-must-not-run-main'; . (Join-Path $root 'Start-Backup.ps1') -HelpersOnly }
finally { $env:OS=$oldOS }
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'Start-Neon-Restore.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count -ne 0) { throw 'Neon launcher does not parse' }
foreach ($name in @('Read-SafeNeonReport','Resolve-NeonBackupFiles','Assert-NeonRunnerOutcome')) {
 $definition=$ast.Find({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 if ($null -eq $definition) { throw 'Missing restore helper' }
 Invoke-Expression $definition.Extent.Text
}
$passed=2
# Execute the actual preamble, stopping before any function or main block.
# This catches dot-source parameter binding changing a caller's CheckOnly flag.
$firstFunction=$ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.FunctionDefinitionAst] } | Select-Object -First 1
$preamble=($ast.EndBlock.Statements | Where-Object { $_.Extent.StartOffset -lt $firstFunction.Extent.StartOffset } | ForEach-Object { $_.Extent.Text }) -join "`n"
$preamble=$preamble.Replace('$PSScriptRoot', ("'"+$root.Replace("'","''")+"'"))
foreach ($requested in @($true,$false)) {
 $CheckOnly=$requested
 Invoke-Expression $preamble
 if ([bool]$CheckOnly -ne $requested) { throw 'Shared helper import changed CheckOnly' }
 $passed++
}
function Expect-Rejection([scriptblock]$Block,[string]$Code) {
 $caught=$false
 try { & $Block | Out-Null } catch {
  if ($_.Exception.Data.Contains('FamBudgetSafeCode') -and $_.Exception.Data['FamBudgetSafeCode'] -eq $Code) { $caught=$true } else { throw }
 }
 if (-not $caught) { throw ('Expected rejection: '+$Code) }
}
$good=@{schemaVersion=1;status='verified';stage='complete';code='OK';restoreVerified=$true;plaintextRemoved=$true;clientMajor=18;targetMajor=18;tables=35;rows=41;photoBlobs=3;photoBytes=2983651;archiveSHA256=('a'*64);backupCreatedAt='2026-10-24T04:00:00+00:00'}
$r=Read-SafeNeonReport ($good|ConvertTo-Json -Compress)
if ($r.status -ne 'verified' -or $r.rows -ne 41) { throw 'Valid report rejected' };$passed++
$failed=@{schemaVersion=1;status='failed';stage='target-empty-check';code='TARGET_NOT_EMPTY';restoreVerified=$false;plaintextRemoved=$true}
$r=Read-SafeNeonReport ($failed|ConvertTo-Json -Compress)
if ($r.code -ne 'TARGET_NOT_EMPTY') { throw 'Lost safe failure code' };$passed++
$unknown=$failed.Clone();$unknown.code='SYNTHETIC_PRIVATE';$unknown.stage='SYNTHETIC_PRIVATE';$unknown.targetUrl='SYNTHETIC_PRIVATE'
$r=Read-SafeNeonReport ($unknown|ConvertTo-Json -Compress)
if (($r|ConvertTo-Json -Compress).Contains('SYNTHETIC_PRIVATE')) { throw 'Report leaked untrusted text' };$passed++
foreach ($text in @('', '[]', '{}', 'not-json', (' '*17000))) {
 Expect-Rejection { Read-SafeNeonReport $text } 'RUNNER_RESULT_INVALID';$passed++
}
foreach ($field in @('restoreVerified','plaintextRemoved')) {
 $bad=$good.Clone();$bad[$field]='true'
 Expect-Rejection { Read-SafeNeonReport ($bad|ConvertTo-Json -Compress) } 'RUNNER_RESULT_INVALID';$passed++
 $bad=$good.Clone();$bad[$field]=$false
 Expect-Rejection { Read-SafeNeonReport ($bad|ConvertTo-Json -Compress) } 'RUNNER_RESULT_INVALID';$passed++
}
foreach ($case in @(@('schemaVersion',$true),@('targetMajor',17),@('clientMajor',19),@('rows',-1),@('tables','35'),@('archiveSHA256',('a'*63)),@('archiveSHA256',(('a'*64)+"`n")),@('backupCreatedAt','SYNTHETIC_PRIVATE'))) {
 $bad=$good.Clone();$bad[$case[0]]=$case[1]
 Expect-Rejection { Read-SafeNeonReport ($bad|ConvertTo-Json -Compress) } 'RUNNER_RESULT_INVALID';$passed++
}
$bad=$failed.Clone();$bad.code='OK'
Expect-Rejection { Read-SafeNeonReport ($bad|ConvertTo-Json -Compress) } 'RUNNER_RESULT_INVALID';$passed++
$bad=$good.Clone();$bad.Remove('tables')
Expect-Rejection { Read-SafeNeonReport ($bad|ConvertTo-Json -Compress) } 'RUNNER_RESULT_INVALID';$passed++
$windowsHost=[Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$filesCases=0
if ($windowsHost) {
 $temporary=Join-Path ([IO.Path]::GetTempPath()) ('fambudget-neon-launcher-tests-'+[Guid]::NewGuid().ToString('N'))
 $backup=Join-Path $temporary '加密 備份';$keys=Join-Path $temporary '獨立金鑰';Set-PrivateDirectory $backup;Set-PrivateDirectory $keys
 try {
  $reports=Join-Path $temporary '報告';Set-PrivateDirectory $reports
  $early=Read-SafeNeonReport (@{schemaVersion=1;status='failed';stage='input';code='TARGET_URL_INVALID';restoreVerified=$false;plaintextRemoved=$false;secret='SYNTHETIC_PRIVATE'}|ConvertTo-Json -Compress)
  Expect-Rejection { Assert-NeonRunnerOutcome $early 1 $reports } 'TARGET_URL_INVALID';$filesCases++
  $failureText=Get-Content -LiteralPath (Join-Path $reports 'verification.json') -Raw
  if ($failureText.Contains('SYNTHETIC_PRIVATE') -or ($failureText|ConvertFrom-Json).code -ne 'TARGET_URL_INVALID') { throw 'Early failure was lost or leaked' };$filesCases++
  Expect-Rejection { Assert-NeonRunnerOutcome (Read-SafeNeonReport ($good|ConvertTo-Json -Compress)) 1 $reports } 'RUNNER_EXIT_FAILED';$filesCases++
  $key=Join-Path $keys 'backup.key' ;[IO.File]::WriteAllText($key,('k'*64))
  $manifest=Join-Path $backup 'postgresql-fixture.json';$archive=Join-Path $backup 'fixture.enc'
  [IO.File]::WriteAllText($archive,'encrypted-fixture')
  [IO.File]::WriteAllText($manifest,'{"archive":"fixture.enc"}')
  $files=Resolve-NeonBackupFiles $backup $key
  if ($files.Archive -cne $archive -or $files.Key -cne $key) { throw 'Unicode/space paths changed' };$filesCases++
  [IO.File]::WriteAllText($manifest,'{"archive":"../outside.enc"}')
  Expect-Rejection { Resolve-NeonBackupFiles $backup $key } 'BACKUP_FILES_INVALID';$filesCases++
  [IO.File]::WriteAllText($manifest,'{"archive":"missing.enc"}')
  Expect-Rejection { Resolve-NeonBackupFiles $backup $key } 'BACKUP_FILES_MISSING';$filesCases++
  [IO.File]::WriteAllText($manifest,'{"archive":"fixture.enc"}')
  [IO.File]::WriteAllText((Join-Path $backup 'postgresql-second.json'),'{}')
  Expect-Rejection { Resolve-NeonBackupFiles $backup $key } 'BACKUP_MANIFEST_REQUIRED';$filesCases++
  Remove-Item -LiteralPath (Join-Path $backup 'postgresql-second.json')
  [IO.File]::WriteAllText($key,'short')
  Expect-Rejection { Resolve-NeonBackupFiles $backup $key } 'BACKUP_FILES_INVALID';$filesCases++
 } finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
@{passed=$passed+$filesCases;reportCases=$passed-2;privateFileCases=$filesCases;windowsOnlySkipped=(-not $windowsHost);productionConnected=$false;restorationPerformed=$false}|ConvertTo-Json -Compress
