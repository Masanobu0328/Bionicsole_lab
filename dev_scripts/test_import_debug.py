import sys
from pathlib import Path
PROJECT_ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from core.geometry_v4_frontend import generate_insole_from_outline
    print("SUCCESS: Imported generate_insole_from_outline")
except ImportError as e:
    print(f"ERROR: {e}")
except Exception as e:
    print(f"OTHER ERROR: {e}")
