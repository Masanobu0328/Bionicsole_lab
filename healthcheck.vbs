' One-click dev pre-flight check for MasaCAD.
' Double-click this file before starting the dev servers.
' It runs healthcheck.ps1 in a visible window that stays open so you can read the result.
Set shell = CreateObject("WScript.Shell")
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
shell.Run "cmd /k powershell -NoProfile -ExecutionPolicy Bypass -File """ & scriptDir & "healthcheck.ps1""", 1, False
