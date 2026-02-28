import sys
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.api.endpoints import router as api_router

app = FastAPI(title="MasaCAD API", version="1.0.0")

# Force reload trigger

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.staticfiles import StaticFiles
from pathlib import Path

app.include_router(api_router, prefix="/api/v1")

# Mount exports directory for static file serving
exports_dir = Path(__file__).parent.parent / "exports"
exports_dir.mkdir(exist_ok=True)
app.mount("/exports", StaticFiles(directory=str(exports_dir)), name="exports")

@app.get("/")
async def root():
    return {"message": "MasaCAD API is running"}

if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)