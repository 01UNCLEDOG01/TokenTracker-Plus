[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$ErrorActionPreference = 'Stop'
$process = Get-Process -Name Gemini | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($null -eq $process) {
    @{ configured = $false } | ConvertTo-Json -Compress
    exit 0
}

$window = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
$documentCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
$listCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)
$textCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)

try {
    $doc = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $documentCondition)
    if ($null -eq $doc) { $doc = $window }
    $items = @($doc.FindAll([System.Windows.Automation.TreeScope]::Descendants, $listCondition) | ForEach-Object {
        $name = [string]$_.Current.Name
        if ($name -match '%' -and $name -notmatch '@|Google Account|Google') { $name }
    })
    $plans = @($doc.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCondition) | ForEach-Object {
        $name = [string]$_.Current.Name
        if ($name -match '^(PRO|Pro|FREE|Free|ULTRA|Ultra|AI Ultra)$') { $name }
    })
    # Read-only: never click settings, never navigate the user's Gemini window.
    @{ configured = $true; items = $items; plans = $plans } | ConvertTo-Json -Compress
} catch {
    @{ configured = $true; error = $_.Exception.Message; items = @(); plans = @() } | ConvertTo-Json -Compress
}
