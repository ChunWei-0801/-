[CmdletBinding()]
param()
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$oldOS=$env:OS
try { $env:OS='helper-import-must-not-run-main'; . (Join-Path $root 'Start-Backup.ps1') -HelpersOnly }
finally { $env:OS=$oldOS }
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'Start-Neon-Compare.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count -ne 0) { throw 'Comparison launcher does not parse' }
foreach ($name in @('Read-SafeCompareReport','Assert-CompareRunnerOutcome')) {
 $definition=$ast.Find({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 if ($null -eq $definition) { throw 'Missing comparison helper' }
 Invoke-Expression $definition.Extent.Text
}
$passed=2
# Exercise the actual preamble, without running any prompt/Docker operation.
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
$good=@{schemaVersion=1;status='verified';stage='complete';code='OK';match=$true;dataMatched=$true;schemaMatched=$true;sequenceMatched=$true;readOnly=$true;sourceMaintenanceObserved=$true;sourceMajor=18;targetMajor=18;clientMajor=18;sourceTables=35;sourceRows=41;sourcePhotoBlobs=3;sourcePhotoBytes=2983651;targetTables=35;targetRows=41;targetPhotoBlobs=3;targetPhotoBytes=2983651;sourceInventorySHA256=('a'*64);targetInventorySHA256=('a'*64);sourceIdentitySHA256=('c'*64);targetIdentitySHA256=('d'*64);comparedAtUtc='2026-10-24T10:00:00+00:00'}
$verified=Read-SafeCompareReport ($good|ConvertTo-Json -Compress)
if (-not $verified.match -or $verified.sourceRows -ne 41 -or $verified.comparedAtUtc -isnot [string]) { throw 'Valid report rejected' };$passed++
foreach ($field in @('dataMatched','schemaMatched','sequenceMatched')) {
 $different=$good.Clone();$different.status='different';$different.code='DATABASES_DIFFER';$different.match=$false;$different[$field]=$false;$different.targetInventorySHA256=('b'*64)
 $r=Read-SafeCompareReport ($different|ConvertTo-Json -Compress)
 if ($r.status -ne 'different' -or $r.match -or $r.$field) { throw 'Legitimate difference was lost' };$passed++
}
$failed=@{schemaVersion=1;status='failed';stage='source-maintenance';code='SOURCE_MAINTENANCE_REQUIRED';match=$false;dataMatched=$false;schemaMatched=$false;sequenceMatched=$false;readOnly=$false;sourceMaintenanceObserved=$false}
$r=Read-SafeCompareReport ($failed|ConvertTo-Json -Compress)
if ($r.code -ne 'SOURCE_MAINTENANCE_REQUIRED') { throw 'Lost safe failure code' };$passed++
$unknown=$failed.Clone();$unknown.code='SYNTHETIC_PRIVATE';$unknown.stage='SYNTHETIC_PRIVATE';$unknown.sourceUrl='SYNTHETIC_PRIVATE';$unknown.targetUrl='SYNTHETIC_PRIVATE';$unknown.rows='SYNTHETIC_PRIVATE'
$r=Read-SafeCompareReport ($unknown|ConvertTo-Json -Compress)
if (($r|ConvertTo-Json -Compress).Contains('SYNTHETIC_PRIVATE')) { throw 'Untrusted report text escaped whitelist' };$passed++
foreach ($text in @('', '[]', '{}', 'null', 'not-json', (' '*17000))) {
 Expect-Rejection { Read-SafeCompareReport $text } 'RUNNER_RESULT_INVALID';$passed++
}
foreach ($field in @('match','dataMatched','schemaMatched','sequenceMatched','readOnly','sourceMaintenanceObserved')) {
 $bad=$good.Clone();$bad[$field]='true'
 Expect-Rejection { Read-SafeCompareReport ($bad|ConvertTo-Json -Compress) } 'RUNNER_RESULT_INVALID';$passed++
 $bad=$good.Clone();$bad[$field]=$false
 Expect-Rejection { Read-SafeCompareReport ($bad|ConvertTo-Json -Compress) } 'RUNNER_RESULT_INVALID';$passed++
}
foreach ($case in @(@('schemaVersion',$true),@('sourceMajor',17),@('targetMajor',19),@('clientMajor',16),@('sourceRows',-1),@('targetTables','35'),@('targetRows',42),@('sourceInventorySHA256',('a'*63)),@('targetInventorySHA256',('b'*64)),@('targetInventorySHA256',(('a'*64)+"`n")),@('comparedAtUtc','SYNTHETIC_PRIVATE'),@('sourceIdentitySHA256','not-a-hash'),@('targetIdentitySHA256',('d'*63)),@('targetIdentitySHA256',('c'*64)))) {
 $bad=$good.Clone();$bad[$case[0]]=$case[1]
 Expect-Rejection { Read-SafeCompareReport ($bad|ConvertTo-Json -Compress) } 'RUNNER_RESULT_INVALID';$passed++
}
foreach ($code in @('OK','DATABASES_DIFFER')) {
 $bad=$failed.Clone();$bad.code=$code
 Expect-Rejection { Read-SafeCompareReport ($bad|ConvertTo-Json -Compress) } 'RUNNER_RESULT_INVALID';$passed++
}
foreach ($missing in @('sourceTables','sourceIdentitySHA256','targetIdentitySHA256')) {
 $bad=$good.Clone();$bad.Remove($missing)
 Expect-Rejection { Read-SafeCompareReport ($bad|ConvertTo-Json -Compress) } 'RUNNER_RESULT_INVALID';$passed++
}
$bad=$good.Clone();$bad.status='different';$bad.code='DATABASES_DIFFER';$bad.match=$false;$bad.targetInventorySHA256=('b'*64)
Expect-Rejection { Read-SafeCompareReport ($bad|ConvertTo-Json -Compress) } 'RUNNER_RESULT_INVALID';$passed++
$bad=$good.Clone();$bad.status='different';$bad.code='DATABASES_DIFFER';$bad.match=$false;$bad.dataMatched=$false
Expect-Rejection { Read-SafeCompareReport ($bad|ConvertTo-Json -Compress) } 'RUNNER_RESULT_INVALID';$passed++
$noOutput=Join-Path ([IO.Path]::GetTempPath()) ('comparison-outcome-unused-'+[Guid]::NewGuid().ToString('N'))
Assert-CompareRunnerOutcome $verified 0 $noOutput
if ([IO.Directory]::Exists($noOutput)) { throw 'Successful outcome unexpectedly created report directory' };$passed++
$diffRaw=$good.Clone();$diffRaw.status='different';$diffRaw.code='DATABASES_DIFFER';$diffRaw.match=$false;$diffRaw.sequenceMatched=$false;$diffRaw.targetInventorySHA256=('b'*64)
$diff=Read-SafeCompareReport ($diffRaw|ConvertTo-Json -Compress)
Assert-CompareRunnerOutcome $diff 2 $noOutput;$passed++
Expect-Rejection { Assert-CompareRunnerOutcome $verified 2 $noOutput } 'RUNNER_EXIT_FAILED';$passed++
Expect-Rejection { Assert-CompareRunnerOutcome $diff 0 $noOutput } 'RUNNER_EXIT_FAILED';$passed++
Expect-Rejection { Assert-CompareRunnerOutcome (Read-SafeCompareReport ($failed|ConvertTo-Json -Compress)) 0 $noOutput } 'RUNNER_EXIT_FAILED';$passed++
$windowsHost=[Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$privateCases=0
if ($windowsHost) {
 $temporary=Join-Path ([IO.Path]::GetTempPath()) ('fambudget-compare-launcher-tests-'+[Guid]::NewGuid().ToString('N'))
 $reports=Join-Path $temporary '私人 比對報告';Set-PrivateDirectory $reports
 try {
  $early=$failed.Clone();$early.private='SYNTHETIC_PRIVATE'
  $early=Read-SafeCompareReport ($early|ConvertTo-Json -Compress)
  Expect-Rejection { Assert-CompareRunnerOutcome $early 1 $reports } 'SOURCE_MAINTENANCE_REQUIRED';$privateCases++
  $reportPath=Join-Path $reports 'comparison.json'
  $text=Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8
  if ($text.Contains('SYNTHETIC_PRIVATE') -or ($text|ConvertFrom-Json).code -ne 'SOURCE_MAINTENANCE_REQUIRED') { throw 'Early failure was masked or leaked' };$privateCases++
  Assert-PrivateFiles $reports;$privateCases++
 } finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
@{passed=$passed+$privateCases;privateReportCases=$privateCases;windowsOnlySkipped=(-not $windowsHost);productionConnected=$false;comparisonPerformed=$false}|ConvertTo-Json -Compress
