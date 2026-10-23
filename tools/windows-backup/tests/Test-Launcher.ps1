[CmdletBinding()]
param([string]$ScriptPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'Start-Backup.ps1'))

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$windowsHost = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ('Launcher syntax errors: ' + (($parseErrors | ForEach-Object { $_.ErrorId }) -join ', ')) }

# Load only the public, side-effect-free definitions needed by these checks.
# The launcher's main block never runs: no Docker command or database connection.
foreach ($name in @('Stop-Safely', 'ConvertTo-NativeArgument', 'Read-SafeRunnerReport',
        'Assert-PrivatePath', 'Set-PrivateDirectory', 'Assert-PrivateFiles')) {
    $definition = $ast.Find({ param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true)
    if ($null -eq $definition) { throw ('Required launcher helper missing: ' + $name) }
    Invoke-Expression $definition.Extent.Text
}

$fixtures = @'
[{"input": "", "expected": "\"\""}, {"input": "simple", "expected": "simple"}, {"input": "one two", "expected": "\"one two\""}, {"input": "C:\\no-space\\", "expected": "C:\\no-space\\"}, {"input": "C:\\has space\\", "expected": "\"C:\\has space\\\\\""}, {"input": "embedded\"quote", "expected": "\"embedded\\\"quote\""}, {"input": "slashes\\\\\"quoted", "expected": "\"slashes\\\\\\\\\\\"quoted\""}, {"input": "trailing space \\\\", "expected": "\"trailing space \\\\\\\\\""}, {"input": "台灣家庭", "expected": "台灣家庭"}, {"input": "two\tcolumns", "expected": "\"two\tcolumns\""}, {"input": "two\nlines", "expected": "\"two\nlines\""}, {"input": "one\\\"two three\\", "expected": "\"one\\\\\\\"two three\\\\\""}]
'@ | ConvertFrom-Json
$passed = 1 # Entire launcher parsed without errors.
$nativeCases = 0
if ($windowsHost) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace FamBudgetLauncherTests {
    public static class NativeArguments {
        [DllImport("shell32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
        static extern IntPtr CommandLineToArgvW(string commandLine, out int count);
        [DllImport("kernel32.dll")]
        static extern IntPtr LocalFree(IntPtr pointer);
        public static string[] Parse(string commandLine) {
            int count;
            IntPtr pointer = CommandLineToArgvW(commandLine, out count);
            if (pointer == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
            try {
                string[] arguments = new string[count];
                for (int i=0; i<count; i++) {
                    arguments[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer, i * IntPtr.Size));
                }
                return arguments;
            } finally { LocalFree(pointer); }
        }
    }
}
'@
}
for ($index = 0; $index -lt $fixtures.Count; $index++) {
    $actual = ConvertTo-NativeArgument $fixtures[$index].input
    if ($actual -cne $fixtures[$index].expected) { throw ('Argument fixture failed: ' + $index) }
    $passed++
    if ($windowsHost) {
        # Use Windows' actual argument decoder, rather than a second copy of the
        # quoting implementation, to test spaces, quotes, slashes and Unicode.
        $decoded = [FamBudgetLauncherTests.NativeArguments]::Parse('fambudget.exe ' + $actual)
        if ($decoded.Count -ne 2 -or $decoded[1] -cne $fixtures[$index].input) {
            throw ('Windows native argument roundtrip failed: ' + $index)
        }
        $passed++
        $nativeCases++
    }
}

$verified = @{status='verified'; verified=$true; backupCompleted=$true; productionBackupCompleted=$true; restoreVerified=$true; plaintextRemoved=$true}
$failed = @{status='failed'; verified=$false; backupCompleted=$false; productionBackupCompleted=$false; restoreVerified=$false; plaintextRemoved=$true; stage='source-connection'; code='OPERATION_FAILED'}
$reportCases = 0
$result = Read-SafeRunnerReport ($verified | ConvertTo-Json -Compress)
if ($result.status -ne 'verified' -or -not $result.verified) { throw 'Verified report was rejected' }
$reportCases++
$result = Read-SafeRunnerReport ($failed | ConvertTo-Json -Compress)
if ($result.stage -ne 'source-connection' -or $result.code -ne 'OPERATION_FAILED' -or $result.backupCompleted) {
    throw 'Original failure stage/code was lost'
}
$reportCases++
$untrusted = $failed.Clone()
$untrusted.stage = 'synthetic-private-text'
$untrusted.code = 'synthetic-private-text'
$untrusted.secret = 'synthetic-private-text'
$result = Read-SafeRunnerReport ($untrusted | ConvertTo-Json -Compress)
if ($result.stage -ne 'runner' -or $result.code -ne 'RUNNER_FAILED' -or
        ($result | ConvertTo-Json -Compress).Contains('synthetic-private-text')) {
    throw 'Untrusted report fields escaped the whitelist'
}
$reportCases++
$partial = $failed.Clone()
$partial.backupCompleted = $true
$partial.productionBackupCompleted = $true
$partial.stage = 'isolated-restore'
$partial.code = 'RESTORE_NOT_VERIFIED'
$result = Read-SafeRunnerReport ($partial | ConvertTo-Json -Compress)
if (-not $result.backupCompleted -or $result.stage -ne 'isolated-restore' -or $result.code -ne 'RESTORE_NOT_VERIFIED') {
    throw 'Partial encrypted backup status was lost'
}
$reportCases++
$invalid = @('', 'not-json', '[]', '"text"', 'null', '{}', (' ' * 16385))
$wrongBoolean = $verified.Clone(); $wrongBoolean.verified = 'true'
$invalid += ($wrongBoolean | ConvertTo-Json -Compress)
$missing = $verified.Clone(); $missing.Remove('plaintextRemoved')
$invalid += ($missing | ConvertTo-Json -Compress)
$nullBoolean = $verified.Clone(); $nullBoolean.restoreVerified = $null
$invalid += ($nullBoolean | ConvertTo-Json -Compress)
foreach ($candidate in $invalid) {
    $rejected = $false
    try { [void](Read-SafeRunnerReport $candidate) } catch {
        if ($_.Exception.Data['FamBudgetSafeCode'] -ne 'RUNNER_RESULT_INVALID') { throw 'Unexpected report exception' }
        $rejected = $true
    }
    if (-not $rejected) { throw 'Invalid report accepted' }
    $reportCases++
}
$passed += $reportCases

$aclCases = 0
$pathCases = 0
if ($windowsHost) {
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ('fambudget-launcher-test-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($temporary)
    try {
        $private = Join-Path $temporary 'private'
        Set-PrivateDirectory $private
        $file = Join-Path $private 'synthetic.txt'
        [IO.File]::WriteAllText($file, 'public synthetic fixture')
        Assert-PrivateFiles $private
        $acl = Get-Acl -LiteralPath $private
        if (-not $acl.AreAccessRulesProtected) { throw 'Private directory inherited broad access' }
        $aclCases++

        $users = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')
        $fileAcl = Get-Acl -LiteralPath $file
        $wideRule = New-Object Security.AccessControl.FileSystemAccessRule($users,
            [Security.AccessControl.FileSystemRights]::Read, [Security.AccessControl.AccessControlType]::Allow)
        [void]$fileAcl.AddAccessRule($wideRule)
        Set-Acl -LiteralPath $file -AclObject $fileAcl
        $rejected = $false
        try { Assert-PrivateFiles $private } catch {
            if ($_.Exception.Data['FamBudgetSafeCode'] -ne 'PRIVATE_ACL_FAILED') { throw 'Unexpected ACL exception' }
            $rejected = $true
        }
        if (-not $rejected) { throw 'Broad file access was accepted' }
        $aclCases++

        foreach ($gitKind in @('directory', 'file')) {
            $checkout = Join-Path $temporary ('checkout-' + $gitKind)
            [void][IO.Directory]::CreateDirectory($checkout)
            $git = Join-Path $checkout '.git'
            if ($gitKind -eq 'directory') { [void][IO.Directory]::CreateDirectory($git) }
            else { [IO.File]::WriteAllText($git, 'gitdir: synthetic') }
            $rejected = $false
            try { Assert-PrivatePath (Join-Path $checkout 'private-output') } catch {
                if ($_.Exception.Data['FamBudgetSafeCode'] -ne 'OUTPUT_INSIDE_GIT') { throw 'Unexpected Git guard exception' }
                $rejected = $true
            }
            if (-not $rejected) { throw 'Private output inside Git was accepted' }
            $pathCases++
        }

        $junctionTarget = Join-Path $temporary 'junction-target'
        [void][IO.Directory]::CreateDirectory($junctionTarget)
        $junction = Join-Path $temporary 'junction-link'
        [void](New-Item -ItemType Junction -Path $junction -Target $junctionTarget)
        $rejected = $false
        try { Assert-PrivatePath (Join-Path $junction 'private-output') } catch {
            if ($_.Exception.Data['FamBudgetSafeCode'] -ne 'OUTPUT_REPARSE_POINT') { throw 'Unexpected junction guard exception' }
            $rejected = $true
        }
        if (-not $rejected) { throw 'Private output through a junction was accepted' }
        $pathCases++
        # Delete only the junction itself before recursively removing fixtures.
        [IO.Directory]::Delete($junction)
    } finally {
        if ([IO.Directory]::Exists($temporary)) { Remove-Item -LiteralPath $temporary -Recurse -Force }
    }
    $passed += $aclCases + $pathCases
}

[ordered]@{
    passed = $passed
    syntaxErrors = 0
    argvFixtureCases = $fixtures.Count
    nativeWindowsArgvCases = $nativeCases
    safeReportCases = $reportCases
    privateAclCases = $aclCases
    privatePathCases = $pathCases
    windowsOnlySkipped = (-not $windowsHost)
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    launcherSHA256 = (Get-FileHash -LiteralPath $ScriptPath -Algorithm SHA256).Hash.ToLowerInvariant()
    productionConnected = $false
    formalBackupCompleted = $false
} | ConvertTo-Json -Compress
