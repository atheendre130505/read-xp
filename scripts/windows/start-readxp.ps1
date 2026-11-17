# Opens Read XP (GitHub Pages) in its own browser window: no tabs, no address bar, nothing else to click.
# Run by the "Read XP" Desktop shortcut through start-readxp.vbs, so no console window flashes.
$Url = 'https://atheendre130505.github.io/read-xp/'
foreach ($p in @("$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
                 "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
                 "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
                 "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
                 "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
                 "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe")) {
  if (Test-Path $p) { Start-Process $p "--app=$Url --start-maximized"; exit 0 }
}
Start-Process $Url
