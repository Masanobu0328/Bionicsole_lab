Set shell = CreateObject("WScript.Shell")

command = "powershell -NoProfile -ExecutionPolicy Bypass -Command ""$ports = @(8000, 3000); " & _
    "$processIds = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue | " & _
    "Select-Object -ExpandProperty OwningProcess -Unique; " & _
    "if ($processIds) { $processIds | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"""

shell.Run command, 7, True
MsgBox "Development servers stopped. Ports 8000 and 3000 are clear.", vbInformation, "MasaCAD"
