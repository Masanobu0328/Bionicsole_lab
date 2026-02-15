
import os

search_str = "remove_degenerate_faces"
root_dir = "."

print(f"Searching for '{search_str}' in '{os.path.abspath(root_dir)}'...")

for dirpath, dirnames, filenames in os.walk(root_dir):
    # Skip .git, .venv, etc.
    if ".git" in dirpath or ".venv" in dirpath or "__pycache__" in dirpath:
        continue
        
    for filename in filenames:
        filepath = os.path.join(dirpath, filename)
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                if search_str in content:
                    print(f"Found in: {filepath}")
                    for i, line in enumerate(content.splitlines()):
                        if search_str in line:
                            print(f"  Line {i+1}: {line.strip()}")
        except Exception as e:
            print(f"Could not read {filepath}: {e}")
