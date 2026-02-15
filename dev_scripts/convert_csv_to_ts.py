import os
import csv
import json

def convert():
    csv_path = r"patients/0001/outline.csv"
    ts_path = r"frontend/src/lib/demo-data.ts"
    
    with open(csv_path, 'r') as f:
        csv_content = f.read()
        
    ts_content = f"export const DEMO_OUTLINE_CSV = `\n{csv_content}\n`;"
    
    with open(ts_path, 'w', encoding='utf-8') as f:
        f.write(ts_content)
    
    print(f"Written to {ts_path}")

if __name__ == "__main__":
    convert()
