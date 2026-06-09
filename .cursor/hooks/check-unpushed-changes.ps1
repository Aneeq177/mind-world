# Cursor stop hook: remind the agent to commit and push if work is still local.
$ErrorActionPreference = "SilentlyContinue"

$null = [Console]::In.ReadToEnd()

function Write-HookJson([hashtable]$Payload) {
    $Payload | ConvertTo-Json -Compress | Write-Output
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-HookJson @{}
    exit 0
}

if (-not (Test-Path ".git")) {
    Write-HookJson @{}
    exit 0
}

$porcelain = git status --porcelain 2>$null
$branch = git branch --show-current 2>$null
$upstream = git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null
$ahead = 0

if ($upstream) {
    $aheadText = git rev-list --count "$upstream..HEAD" 2>$null
    if ($aheadText -match '^\d+$') {
        $ahead = [int]$aheadText
    }
}

# Only tracked modifications count — ignore untracked (??) local files
$trackedChanges = @()
if ($porcelain) {
    $trackedChanges = $porcelain -split "`n" | Where-Object {
        $_ -and $_ -notmatch '^\?\? '
    }
}
$hasLocalChanges = $trackedChanges.Count -gt 0
$hasUnpushedCommits = $ahead -gt 0

if (-not $hasLocalChanges -and -not $hasUnpushedCommits) {
    Write-HookJson @{}
    exit 0
}

$details = @()
if ($hasLocalChanges) { $details += "uncommitted file changes" }
if ($hasUnpushedCommits) { $details += "$ahead unpushed commit(s)" }

$branchLabel = if ($branch) { $branch } else { "current branch" }
$detailText = ($details -join " and ")

$message = @"
Before ending this task, commit and push to GitHub. The repo still has $detailText on $branchLabel.

Follow the project's auto-push rule:
1. Review git status and git diff
2. Stage only relevant files (never secrets)
3. Commit with a clear message
4. Push with: git push -u origin HEAD
5. Confirm the push succeeded in your reply
"@

Write-HookJson @{ followup_message = $message.Trim() }
exit 0
