# ติดตั้ง/ถอนการเริ่มบ้านดี POS อัตโนมัติเมื่อเปิดเครื่อง (T2.8, D1 = Windows 11)
# ใช้ Task Scheduler ให้ node รัน server ตอนเครื่องเริ่มทำงานโดยไม่ต้องล็อกอิน และเริ่มใหม่เมื่อหยุดผิดปกติ
# ต้องเปิด PowerShell แบบ Run as administrator
#   .\scripts\install-service.ps1 -Install
#   .\scripts\install-service.ps1 -Uninstall
param(
  [switch]$Install,
  [switch]$Uninstall,
  [string]$DataDir = "$env:ProgramData\BaandeePOS",
  [int]$Port = 4180
)

$ErrorActionPreference = 'Stop'
$TaskName = 'BaandeePOS'
$Root = Split-Path -Parent $PSScriptRoot

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'กรุณาเปิด PowerShell แบบ Run as administrator'
}

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "ถอน task $TaskName แล้ว (ข้อมูลใน $DataDir ยังอยู่)"
  } else {
    Write-Host "ไม่พบ task $TaskName"
  }
  exit 0
}

if (-not $Install) { Write-Host 'ระบุ -Install หรือ -Uninstall'; exit 2 }

$Node = (Get-Command node).Source
if (-not (Test-Path "$Root\apps\web\dist\index.html")) { throw 'ยังไม่ได้ build หน้าจอ: รัน npm ci และ npm run build ก่อน' }
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# รันผ่าน cmd เพื่อกำหนด env และเก็บ log ต่อท้าย
$Log = Join-Path $DataDir 'server.log'
$Cmd = "set NODE_ENV=production&& set POS_DATA_DIR=$DataDir&& set POS_PORT=$Port&& `"$Node`" `"$Root\apps\server\src\main.ts`" >> `"$Log`" 2>&1"
$Action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c $Cmd" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

# shortcut บน desktop สาธารณะเปิด UI
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut("$env:PUBLIC\Desktop\บ้านดี POS.url")
$Shortcut.TargetPath = "http://127.0.0.1:$Port/"
$Shortcut.Save()

Write-Host "ติดตั้งแล้ว: server เริ่มเองเมื่อเปิดเครื่อง ข้อมูลอยู่ที่ $DataDir log ที่ $Log"
Write-Host "เปิด http://127.0.0.1:$Port/ เพื่อตั้งค่าเจ้าของร้าน"
