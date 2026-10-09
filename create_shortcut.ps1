$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'AI Lesson Plan Studio.lnk'

$targetExe = Join-Path $PSScriptRoot 'AI_Lesson_Plan_Studio.exe'
$targetVbs = Join-Path $PSScriptRoot 'start_app.vbs'

$s = $ws.CreateShortcut($shortcutPath)
if (Test-Path $targetExe) {
    $s.TargetPath = $targetExe
    $s.Arguments = ""
    $s.IconLocation = "$targetExe,0"
} else {
    $s.TargetPath = "wscript.exe"
    $s.Arguments = "`"$targetVbs`""
    $s.IconLocation = "shell32.dll,14"
}
$s.WorkingDirectory = $PSScriptRoot
$s.Description = 'AI Lesson Plan Studio - កម្មវិធីបង្កើតកិច្ចតែងការបង្រៀនស្វ័យប្រវត្តិ'
$s.Save()

Write-Host "✅ Shortcut created at: $shortcutPath" -ForegroundColor Green
