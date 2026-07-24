Set shell = CreateObject("WScript.Shell")

' Start backend (FastAPI)
shell.CurrentDirectory = "C:\Users\masan\Desktop\insole-ai-design\masacad"
shell.Run "cmd /c python -m uvicorn backend.main:app --reload --port 8000", 7, False

' Start frontend (Next.js)
shell.CurrentDirectory = "C:\Users\masan\Desktop\insole-ai-design\masacad\frontend"
shell.Run "cmd /c npm run dev", 7, False

WScript.Sleep 4000
shell.Run "http://localhost:3000"
