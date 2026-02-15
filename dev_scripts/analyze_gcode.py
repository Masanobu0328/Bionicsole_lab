"""G-codeファイルの分析スクリプト"""
import sys
import re
from pathlib import Path
from collections import defaultdict

# Windowsの標準出力で絵文字が出ると失敗するためUTF-8に固定
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except:
        pass

def analyze_gcode(gcode_path: Path):
    """G-codeファイルを分析"""
    
    if not gcode_path.exists():
        print(f"Error: {gcode_path} not found")
        return
    
    print("=" * 60)
    print("G-code Analysis")
    print("=" * 60)
    print(f"File: {gcode_path}")
    
    with open(gcode_path, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    
    print(f"\nTotal lines: {len(lines):,}")
    
    # 基本統計
    g_commands = defaultdict(int)
    m_commands = defaultdict(int)
    layer_count = 0
    total_extrusion = 0.0
    print_time = None
    filament_used = None
    
    # レイヤー情報
    layers = []
    current_layer = None
    layer_z = None
    
    # エラー/警告検出
    errors = []
    warnings = []
    
    for i, line in enumerate(lines, 1):
        line_stripped = line.strip()
        
        # コメント行をスキップ（情報抽出用）
        if line_stripped.startswith(';'):
            # スライサー情報の抽出
            if 'TIME:' in line_stripped.upper():
                time_match = re.search(r'TIME:?\s*(\d+)', line_stripped, re.IGNORECASE)
                if time_match:
                    print_time = int(time_match.group(1))
            
            if 'FILAMENT_USED' in line_stripped.upper() or 'MATERIAL' in line_stripped.upper():
                filament_match = re.search(r'(\d+\.?\d*)\s*MM', line_stripped, re.IGNORECASE)
                if filament_match:
                    filament_used = float(filament_match.group(1))
            
            if 'LAYER:' in line_stripped.upper() or 'LAYER COUNT' in line_stripped.upper():
                layer_match = re.search(r'(\d+)', line_stripped)
                if layer_match:
                    layer_count = max(layer_count, int(layer_match.group(1)))
            
            continue
        
        # G-codeコマンドの解析
        if line_stripped.startswith('G'):
            g_match = re.match(r'G(\d+)', line_stripped)
            if g_match:
                g_num = int(g_match.group(1))
                g_commands[g_num] += 1
        
        if line_stripped.startswith('M'):
            m_match = re.match(r'M(\d+)', line_stripped)
            if m_match:
                m_num = int(m_match.group(1))
                m_commands[m_num] += 1
        
        # レイヤー変更の検出（Z座標の変化）
        z_match = re.search(r'Z([-\d\.]+)', line_stripped)
        if z_match:
            new_z = float(z_match.group(1))
            if layer_z is None or abs(new_z - layer_z) > 0.01:  # 0.01mm以上の変化
                if layer_z is not None:
                    layers.append({
                        'z': layer_z,
                        'line_start': current_layer,
                        'line_end': i - 1
                    })
                layer_z = new_z
                current_layer = i
                layer_count += 1
        
        # エクストルージョン量の累積
        e_match = re.search(r'E([-\d\.]+)', line_stripped)
        if e_match:
            total_extrusion += float(e_match.group(1))
    
    # 最後のレイヤーを追加
    if layer_z is not None:
        layers.append({
            'z': layer_z,
            'line_start': current_layer,
            'line_end': len(lines)
        })
    
    # 結果表示
    print("\n" + "=" * 60)
    print("Basic Information")
    print("=" * 60)
    
    if print_time:
        hours = print_time // 3600
        minutes = (print_time % 3600) // 60
        seconds = print_time % 60
        print(f"Estimated print time: {hours}h {minutes}m {seconds}s ({print_time}s)")
    
    if filament_used:
        print(f"Filament used: {filament_used:.2f} mm")
    
    print(f"Layers detected: {len(layers):,}")
    if layer_count > 0:
        print(f"Layer count (from comments): {layer_count}")
    
    print(f"Total extrusion moves: {total_extrusion:.2f} mm")
    
    print("\n" + "=" * 60)
    print("G-code Commands")
    print("=" * 60)
    print("G commands:")
    for g_num in sorted(g_commands.keys()):
        print(f"  G{g_num}: {g_commands[g_num]:,} times")
    
    print("\nM commands:")
    for m_num in sorted(m_commands.keys()):
        print(f"  M{m_num}: {m_commands[m_num]:,} times")
    
    print("\n" + "=" * 60)
    print("Layer Information")
    print("=" * 60)
    if layers:
        print(f"First layer Z: {layers[0]['z']:.3f} mm")
        print(f"Last layer Z: {layers[-1]['z']:.3f} mm")
        print(f"Layer height: {layers[1]['z'] - layers[0]['z']:.3f} mm" if len(layers) > 1 else "N/A")
        
        # 最初の5層と最後の5層を表示
        print("\nFirst 5 layers:")
        for i, layer in enumerate(layers[:5]):
            print(f"  Layer {i+1}: Z={layer['z']:.3f}mm, Lines {layer['line_start']}-{layer['line_end']}")
        
        if len(layers) > 5:
            print("\nLast 5 layers:")
            for i, layer in enumerate(layers[-5:], len(layers)-4):
                print(f"  Layer {i}: Z={layer['z']:.3f}mm, Lines {layer['line_start']}-{layer['line_end']}")
    
    # エラー/警告の検出
    print("\n" + "=" * 60)
    print("Quality Check")
    print("=" * 60)
    
    # 一般的な問題の検出
    issues = []
    
    # レイヤー数の妥当性チェック
    if len(layers) < 10:
        issues.append("WARNING: Very few layers detected - may indicate slicing issues")
    
    # エクストルージョン量のチェック
    if total_extrusion < 100:
        issues.append("WARNING: Very low extrusion amount - may indicate empty/invalid G-code")
    
    if issues:
        for issue in issues:
            print(f"[!] {issue}")
    else:
        print("[OK] No obvious issues detected")
    
    print("\n" + "=" * 60)
    print("Analysis Complete")
    print("=" * 60)
    
    return {
        'layers': len(layers),
        'print_time': print_time,
        'filament_used': filament_used,
        'total_extrusion': total_extrusion,
        'g_commands': dict(g_commands),
        'm_commands': dict(m_commands)
    }


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        gcode_path = Path(sys.argv[1])
    else:
        # デフォルトパス
        gcode_path = Path("exports/generated_v4_insole.gcode")
    
    if not gcode_path.exists():
        print(f"Usage: python {sys.argv[0]} <gcode_file>")
        print(f"Or place G-code file at: {gcode_path}")
        sys.exit(1)
    
    analyze_gcode(gcode_path)
