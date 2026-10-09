Set WshShell = CreateObject("WScript.Shell")
strCurrentDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

' Run silent_launcher.py completely hidden (WindowStyle = 0)
On Error Resume Next
WshShell.Run "pyw.exe """ & strCurrentDir & "\silent_launcher.py""", 0, False
If Err.Number <> 0 Then
    Err.Clear
    WshShell.Run "py.exe """ & strCurrentDir & "\silent_launcher.py""", 0, False
    If Err.Number <> 0 Then
        Err.Clear
        WshShell.Run "pythonw.exe """ & strCurrentDir & "\silent_launcher.py""", 0, False
        If Err.Number <> 0 Then
            Err.Clear
            WshShell.Run "python.exe """ & strCurrentDir & "\silent_launcher.py""", 0, False
            If Err.Number <> 0 Then
                Err.Clear
                WshShell.Run "cmd.exe /c """ & strCurrentDir & "\start_app.bat""", 1, False
            End If
        End If
    End If
End If
On Error GoTo 0
