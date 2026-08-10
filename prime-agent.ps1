#requires -Version 5.1
<#
.SYNOPSIS
    Windows launcher for Prime Agent from a source checkout.
    Mirrors prime-agent.sh: supports --no-env and --dist.
.EXAMPLE
    .\prime-agent.ps1
    .\prime-agent.ps1 --dist
    .\prime-agent.ps1 --no-env --provider openai
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PRIME_AGENT_LAUNCHER_PATH = Join-Path $ScriptDir "prime-agent.ps1"

$buildId = git -C $ScriptDir describe --tags --always --dirty 2>$null
if ($LASTEXITCODE -eq 0 -and $buildId) {
    $env:PRIME_AGENT_BUILD_ID = $buildId
}

$noEnv = $false
$useDist = $false
$forwardedArgs = @()
foreach ($arg in $Args) {
    switch ($arg) {
        "--no-env" { $noEnv = $true }
        "--dist"   { $useDist = $true }
        default    { $forwardedArgs += $arg }
    }
}

if ($noEnv) {
    # Unset API keys (see packages/ai/src/env-api-keys.ts)
    $keyVars = @(
        "ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN", "OPENAI_API_KEY", "PRIME_API_KEY",
        "GEMINI_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "XAI_API_KEY", "OPENROUTER_API_KEY",
        "ZAI_API_KEY", "MISTRAL_API_KEY", "MINIMAX_API_KEY", "MINIMAX_CN_API_KEY", "AI_GATEWAY_API_KEY",
        "OPENCODE_API_KEY", "COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "HF_TOKEN",
        "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION",
        "AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION",
        "AWS_DEFAULT_REGION", "AWS_BEARER_TOKEN_BEDROCK", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
        "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_WEB_IDENTITY_TOKEN_FILE",
        "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_BASE_URL", "AZURE_OPENAI_RESOURCE_NAME"
    )
    foreach ($var in $keyVars) {
        Remove-Item "Env:$var" -ErrorAction SilentlyContinue
    }
    Write-Host "Running Prime Agent without API keys..."
}

# --dist runs the bundled build (what users get; ~3x faster startup than tsx).
if ($useDist) {
    $bundle = Join-Path $ScriptDir "packages\coding-agent\dist\bundle\cli.js"
    if (-not (Test-Path $bundle)) {
        Write-Error "Bundle not found at $bundle. Run npm run build first."
        exit 1
    }
    & node $bundle @forwardedArgs
    exit $LASTEXITCODE
}

$tsxBin = Join-Path $ScriptDir "node_modules\.bin\tsx.CMD"
if (-not (Test-Path $tsxBin)) {
    $tsxBin = Join-Path $ScriptDir "node_modules\.bin\tsx.ps1"
}
if (-not (Test-Path $tsxBin)) {
    Write-Error "tsx not found at $ScriptDir\node_modules\.bin. Run npm install from the repo root first."
    exit 1
}

& $tsxBin (Join-Path $ScriptDir "packages\coding-agent\src\cli.ts") @forwardedArgs
exit $LASTEXITCODE
