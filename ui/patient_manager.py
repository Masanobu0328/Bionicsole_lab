"""
MasaCAD - Patient Manager Module
患者管理システム

機能:
- 患者一覧の読み込み/保存
- 新規患者追加（ID自動採番）
- 患者フォルダの自動生成
- patients.json の管理
"""

import json
from pathlib import Path
from typing import List, Dict, Optional
import sys

# プロジェクトルートを取得（ui/patient_manager.pyから見て../）
def _get_project_root():
    """プロジェクトルートを取得"""
    return Path(__file__).parent.parent.resolve()

def _get_patients_dir():
    """patients/ ディレクトリのパスを取得"""
    return _get_project_root() / "patients"

def _get_patients_json():
    """patients.json のパスを取得"""
    return _get_patients_dir() / "patients.json"


def ensure_patients_dir():
    """patients/ ディレクトリが存在しない場合は作成"""
    patients_dir = _get_patients_dir()
    patients_json = _get_patients_json()
    
    patients_dir.mkdir(parents=True, exist_ok=True)
    if not patients_json.exists():
        # 空の患者リストで初期化（save_patients()を呼ばずに直接作成）
        try:
            with open(patients_json, 'w', encoding='utf-8') as f:
                json.dump([], f, ensure_ascii=False, indent=2)
            print(f"[INFO] 患者リスト初期化完了")
        except Exception as e:
            print(f"[ERROR] 患者リスト初期化失敗: {e}")


def load_patients() -> List[Dict]:
    """
    患者一覧を読み込む
    
    Returns:
        List[Dict]: 患者情報のリスト [{"id": "0001", "name": "患者A", "note": "メモ"}, ...]
    """
    ensure_patients_dir()
    patients_json = _get_patients_json()
    
    if not patients_json.exists():
        return []
    
    try:
        with open(patients_json, 'r', encoding='utf-8') as f:
            patients = json.load(f)
        if not isinstance(patients, list):
            return []
        return patients
    except Exception as e:
        print(f"[ERROR] 患者リスト読み込み失敗: {e}")
        return []


def save_patients(patients: List[Dict]):
    """
    患者一覧を保存
    
    Args:
        patients: 患者情報のリスト
    """
    ensure_patients_dir()
    patients_json = _get_patients_json()
    
    try:
        with open(patients_json, 'w', encoding='utf-8') as f:
            json.dump(patients, f, ensure_ascii=False, indent=2)
        print(f"[INFO] 患者リスト保存完了: {len(patients)}件")
    except Exception as e:
        print(f"[ERROR] 患者リスト保存失敗: {e}")
        raise


def get_next_patient_id() -> str:
    """
    次の患者IDを自動採番（4桁ゼロ埋め）
    
    Returns:
        str: 新しい患者ID（例: "0001", "0002"）
    """
    patients = load_patients()
    if not patients:
        return "0001"
    
    # 既存のIDから最大値を取得
    existing_ids = [int(p.get("id", "0")) for p in patients if p.get("id", "").isdigit()]
    if not existing_ids:
        return "0001"
    
    next_id = max(existing_ids) + 1
    return f"{next_id:04d}"


def create_patient(name: str, note: str = "") -> Dict:
    """
    新規患者を作成
    
    Args:
        name: 患者名
        note: メモ（オプション）
    
    Returns:
        Dict: 作成された患者情報 {"id": "0001", "name": "患者A", "note": "メモ"}
    """
    patients = load_patients()
    
    # 新しいIDを採番
    patient_id = get_next_patient_id()
    
    # 患者情報を作成
    new_patient = {
        "id": patient_id,
        "name": name.strip(),
        "note": note.strip()
    }
    
    # リストに追加
    patients.append(new_patient)
    save_patients(patients)
    
    # 患者フォルダを作成
    patient_dir = get_patient_dir(patient_id)
    patient_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"[INFO] 新規患者作成: ID={patient_id}, 名前={name}")
    
    return new_patient


def get_patient_dir(patient_id: str) -> Path:
    """
    患者フォルダのパスを取得
    
    Args:
        patient_id: 患者ID（例: "0001"）
    
    Returns:
        Path: 患者フォルダのパス（例: patients/0001/）
    """
    ensure_patients_dir()
    return _get_patients_dir() / patient_id


def get_patient_csv_path(patient_id: str) -> Path:
    """
    患者のCSVファイルパスを取得
    
    Args:
        patient_id: 患者ID
    
    Returns:
        Path: CSVファイルのパス（例: patients/0001/outline.csv）
    """
    return get_patient_dir(patient_id) / "outline.csv"


def get_patient_json_path(patient_id: str) -> Path:
    """
    患者のJSONファイルパスを取得
    
    Args:
        patient_id: 患者ID
    
    Returns:
        Path: JSONファイルのパス（例: patients/0001/design.json）
    """
    return get_patient_dir(patient_id) / "design.json"


def patient_has_csv(patient_id: str) -> bool:
    """
    患者にCSVファイルが存在するかチェック
    
    Args:
        patient_id: 患者ID
    
    Returns:
        bool: CSVファイルが存在する場合True
    """
    csv_path = get_patient_csv_path(patient_id)
    return csv_path.exists() and csv_path.is_file()


def patient_has_json(patient_id: str) -> bool:
    """
    患者にJSONファイルが存在するかチェック
    
    Args:
        patient_id: 患者ID
    
    Returns:
        bool: JSONファイルが存在する場合True
    """
    json_path = get_patient_json_path(patient_id)
    return json_path.exists() and json_path.is_file()


def delete_patient(patient_id: str) -> bool:
    """
    患者を削除（患者フォルダごと削除）
    
    Args:
        patient_id: 患者ID
    
    Returns:
        bool: 削除成功の場合True
    """
    patients = load_patients()
    
    # 患者リストから削除
    patients = [p for p in patients if p.get("id") != patient_id]
    save_patients(patients)
    
    # 患者フォルダを削除
    patient_dir = get_patient_dir(patient_id)
    if patient_dir.exists():
        import shutil
        try:
            shutil.rmtree(patient_dir)
            print(f"[INFO] 患者フォルダ削除: {patient_dir}")
        except Exception as e:
            print(f"[WARN] 患者フォルダ削除失敗: {e}")
    
    print(f"[INFO] 患者削除完了: ID={patient_id}")
    return True


# テスト用
if __name__ == "__main__":
    # 初期化
    ensure_patients_dir()
    
    # テスト患者作成
    patient1 = create_patient("テスト患者A", "テスト用メモ")
    print(f"作成された患者: {patient1}")
    
    # 患者一覧取得
    patients = load_patients()
    print(f"患者一覧: {patients}")
    
    # パス確認
    csv_path = get_patient_csv_path(patient1["id"])
    json_path = get_patient_json_path(patient1["id"])
    print(f"CSVパス: {csv_path}")
    print(f"JSONパス: {json_path}")
    print(f"CSV存在: {patient_has_csv(patient1['id'])}")
    print(f"JSON存在: {patient_has_json(patient1['id'])}")

