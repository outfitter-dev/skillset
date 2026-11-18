param(
  [string]$Root = '.',
  [ValidateSet('repo', 'user')][string]$Scope = 'repo'
)
# Observation only; no execution-policy changes, installs, initialization or build.
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw 'root must be an existing directory' }
$contract = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $PSScriptRoot 'compatibility.env')) {
  $parts = $line.Split('=', 2)
  if ($parts.Length -eq 2) { $contract[$parts[0]] = $parts[1] }
}
if (-not $contract.cli -or $contract.scope -ne 'entry-preview') { throw 'invalid compatibility contract' }
$cli = 'missing'
$version = 'unknown'
$command = Get-Command skillset -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($command) {
  $cli = 'unknown'
  try {
    $observed = @(& $command.Source --version 2>$null)
    if ($LASTEXITCODE -eq 0 -and $observed.Count -eq 1 -and $observed[0] -cmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
      $version = $observed[0]
      $cli = 'incompatible'
      if ($version -ceq $contract.cli) { $cli = 'compatible' }
    }
  } catch { $cli = 'unknown' }
}
'platform=windows'
'shell=powershell'
"scope=$Scope"
"cli=$cli"
"version=$version"
"qualifiedVersion=$($contract.cli)"
"compatibilityScope=$($contract.scope)"
foreach ($runtime in @('node', 'npm', 'bun')) {
  $state = 'missing'
  if (Get-Command $runtime -CommandType Application -ErrorAction SilentlyContinue) { $state = 'present' }
  "$runtime=$state"
}
foreach ($item in @('workspaceConfig:skillset.yaml', 'rootAgents:AGENTS.md', 'rootClaude:CLAUDE.md', 'rootSkill:SKILL.md', 'sourceDirectory:.skillset', 'claudeDirectory:.claude', 'codexDirectory:.codex', 'cursorDirectory:.cursor', 'agentsDirectory:.agents')) {
  $key, $path = $item.Split(':', 2)
  $kind = 'Leaf'
  if ($key.EndsWith('Directory')) { $kind = 'Container' }
  $state = 'absent'
  if (Test-Path -LiteralPath (Join-Path $Root $path) -PathType $kind) { $state = 'present' }
  "$key=$state"
}
exit 0
