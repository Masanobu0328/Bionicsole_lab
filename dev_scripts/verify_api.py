
import requests
import json
import sys

def verify_api():
    url = "http://localhost:8000/api/v1/generate-insole"
    
    # Payload matching the InsoleParams model
    payload = {
        "patient_id": "0001",
        "foot_side": "left",
        "flip_orientation": False,
        "base_thickness": 3.0,
        "wall_height_offset_mm": 0.0,
        "heel_cup_scale": 1.0,
        "arch_scale": 1.0,
        "arch_settings": {
            "medial_start": 15.0,
            "medial_peak": 43.0,
            "medial_end": 70.0,
            "medial_height": 1.0,
            "lateral_start": 20.0,
            "lateral_peak": 32.5,
            "lateral_end": 45.0,
            "lateral_height": 0.5,
            "transverse_start": 43.0,
            "transverse_peak": 59.0,
            "transverse_end": 75.0,
            "transverse_height": 0.5,
            "medial_y_start": 65.0,
            "medial_y_end": 100.0,
            "lateral_y_start": 0.0,
            "lateral_y_end": 25.0,
            "transverse_y_start": 25.0,
            "transverse_y_end": 65.0
        },
        "enable_lattice": False, # Start with simple generation for speed
        "lattice_cell_size": 3.0,
        "strut_radius": 0.2
    }

import time

BASE_URL = "http://localhost:8000/api"

# Payload matching the InsoleParams model
payload = {
    "patient_id": "0001",
    "foot_side": "left",
    "flip_orientation": False,
    "base_thickness": 3.0,
    "wall_height_offset_mm": 0.0,
    "heel_cup_scale": 1.0,
    "arch_scale": 1.0,
    "arch_settings": {
        "medial_start": 15.0,
        "medial_peak": 43.0,
        "medial_end": 70.0,
        "medial_height": 1.0,
        "lateral_start": 20.0,
        "lateral_peak": 32.5,
        "lateral_end": 45.0,
        "lateral_height": 0.5,
        "transverse_start": 43.0,
        "transverse_peak": 59.0,
        "transverse_end": 75.0,
        "transverse_height": 0.5,
        "medial_y_start": 65.0,
        "medial_y_end": 100.0,
        "lateral_y_start": 0.0,
        "lateral_y_end": 25.0,
        "transverse_y_start": 25.0,
        "transverse_y_end": 65.0
    },
    "enable_lattice": False, # Start with simple generation for speed
    "lattice_cell_size": 3.0,
    "strut_radius": 0.2
}

if __name__ == "__main__":
    try:
        # 1. Start generation
        print("Sending POST request to generate insole (async task)...")
        response = requests.post(f"{BASE_URL}/v1/generate-insole", json=payload)
        
        if response.status_code == 200:
            data = response.json()
            task_id = data.get("task_id")
            print(f"[SUCCESS] Task started! Task ID: {task_id}")
            
            # 2. Poll for status
            print("Polling for status...")
            while True:
                r_status = requests.get(f"{BASE_URL}/v1/tasks/{task_id}")
                if r_status.status_code != 200:
                    print(f"[ERROR] Failed to get status: {r_status.status_code}")
                    break
                
                status_data = r_status.json()
                state = status_data.get("status")
                progress = status_data.get("progress")
                message = status_data.get("message")
                
                print(f"Status: {state} ({progress}%) - {message}")
                
                if state == "completed":
                    print("[SUCCESS] Generation completed!")
                    result = status_data.get("result", {})
                    
                    # Check downloads
                    if "download_url" in result:
                        download_url = f"http://localhost:8000{result['download_url']}"
                        r_file = requests.head(download_url)
                        if r_file.status_code == 200:
                            print(f"[SUCCESS] GLB file is downloadable! ({download_url})")
                        else:
                            print(f"[ERROR] GLB download failed: {r_file.status_code}")
                            
                    if "stl_url" in result:
                        stl_url = f"http://localhost:8000{result['stl_url']}"
                        r_stl = requests.head(stl_url)
                        if r_stl.status_code == 200:
                            print(f"[SUCCESS] STL file is downloadable! ({stl_url})")
                        else:
                            print(f"[ERROR] STL download failed: {r_stl.status_code}")
                    break
                    
                elif state == "failed":
                    print(f"[ERROR] Task failed: {message}")
                    break
                
                time.sleep(2)
                
        else:
            print(f"[ERROR] API request failed: {response.text}")

    except Exception as e:
        print(f"[ERROR] Verification script failed: {e}")
        print("Ensure the backend server is running on port 8000.")
