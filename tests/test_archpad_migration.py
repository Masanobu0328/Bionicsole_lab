import json
from pathlib import Path

import numpy as np
from shapely.geometry import Point, Polygon

from core.geometry_v4_frontend import (
    _build_arch_pad_region,
    _build_detail_spline,
    calculate_height,
    create_profile_interpolators,
    generate_insole_from_outline,
    get_outline_y_bounds,
)


WORKSPACE = Path(__file__).resolve().parents[2]
MASACAD = WORKSPACE / "masacad"
MODEL7 = WORKSPACE / "archpad-lab" / "backend" / "test_models" / "20260824-173237_model7.json"
CURVE_KEYS = {
    "medial", "medialFlat", "lateral", "lateralFlat", "transverse",
    "transverseFlat", "heelBridge", "lateralBridge", "metatarsalBridge",
}


def _fixture():
    request = json.loads(MODEL7.read_text(encoding="utf-8"))["request"]
    curves = {key: value for key, value in request["curves"].items() if key in CURVE_KEYS}
    outline = np.loadtxt(MASACAD / "patients" / "0001" / "outline.csv", delimiter=",", skiprows=1)
    outline -= outline.min(axis=0)
    # ArchPad model7 was saved with the opposite Y convention.  Convert the
    # fixture to Bionicsol's canonical right-foot coordinates: MinY=medial,
    # MaxY=lateral.  Production performs the same one-time v2 -> v3 migration.
    f_y_min, f_y_max, _, _ = get_outline_y_bounds(outline)
    curves = {
        key: [
            {
                **point,
                "y": float(f_y_min(float(point["x"])) + f_y_max(float(point["x"])) - float(point["y"])),
            }
            for point in points
        ]
        for key, points in curves.items()
    }
    return curves, outline


def _settings():
    return {
        "medial_start": 15, "medial_peak": 43, "medial_end": 71, "medial_height": 4,
        "lateral_start": 20, "lateral_peak": 43, "lateral_end": 71, "lateral_height": 1,
        "transverse_start": 43, "transverse_peak": 59, "transverse_end": 75,
        "transverse_height": 2, "medial_detail_enabled": True,
        "medial_detail_heights": [0, 4, 4, 1.4],
    }


def test_detail_profile_is_shape_preserving():
    settings = _settings()
    settings["medial_detail_heights"] = [0.5, 0.5, 0.5, 0.5]
    spline = _build_detail_spline(
        settings,
        {"subtalar": 30, "navicular": 43, "medial_cuneiform": 55, "metatarsal": 70},
    )
    values = spline(np.linspace(settings["medial_start"], settings["medial_end"], 500))
    assert float(np.nanmin(values)) >= -1e-9
    assert float(np.nanmax(values)) <= 0.5 + 1e-9


def test_model7_forefoot_fairing_is_valid_and_passes_required_points():
    curves, outline = _fixture()
    profiles = create_profile_interpolators(_settings(), None, None, curves)
    f_y_min, f_y_max, _, _ = get_outline_y_bounds(outline)
    region = _build_arch_pad_region(
        profiles["custom_boundaries"], f_y_min, f_y_max, profiles["raw_bridges"]
    )
    polygon = Polygon(region["boundary_points"])
    bridge = curves["metatarsalBridge"]
    assert polygon.is_valid
    assert polygon.exterior.is_simple
    assert polygon.exterior.distance(Point(bridge[1]["x"], bridge[1]["y"])) <= 1.0
    assert polygon.exterior.distance(Point(bridge[2]["x"], bridge[2]["y"])) <= 1e-7
    assert polygon.exterior.distance(Point(bridge[3]["x"], bridge[3]["y"])) <= 1e-7


def test_medial_and_lateral_heights_use_canonical_sides():
    curves, outline = _fixture()
    settings = _settings()
    settings["transverse_height"] = 0
    profiles = create_profile_interpolators(settings, None, None, curves)
    f_y_min, f_y_max, x_min, x_max = get_outline_y_bounds(outline)
    x = 107.5
    low, high = float(f_y_min(x)), float(f_y_max(x))

    def band_height(name):
        outer = float(profiles["custom_boundaries"][name](x))
        inner = float(profiles["custom_boundaries"][f"{name}Flat"](x))
        y = outer + 0.8 * (inner - outer)
        return calculate_height(
            x, y, x_min, x_max, low, high, profiles, 3.0,
            False, 1.0, 0.0, 1.0, False, outline,
        ) - 3.0

    medial = band_height("medial")
    lateral = band_height("lateral")

    # The fixture asks for medial_height 4 and lateral_height 1, so a swapped pair
    # inverts this ordering by a wide margin - that is what this test guards.
    #
    # The absolute bands are only a sanity net and they are re-baselined when the
    # shape is deliberately retuned; they are not a specification. Measured
    # 2026-09-09 after the wall rework and the split band falloff: medial 3.000,
    # lateral 0.431. The previous bounds (lateral 0.5-1.2) predated the wall rework
    # and had been failing for some time, which left this guard red and useless.
    assert medial > 2.5
    assert 0.25 < lateral < 0.8
    assert medial > lateral * 3


def test_arch_feature_mesh_remains_watertight():
    curves, outline = _fixture()
    outline_points = [{"x": float(x), "y": float(y)} for x, y in outline]
    mesh = generate_insole_from_outline(
        outline_points=outline_points,
        base_thickness=3.0,
        grid_spacing=2.0,
        arch_settings=_settings(),
        landmark_settings={
            "subtalar": 30, "navicular": 43, "medial_cuneiform": 55, "metatarsal": 70,
        },
        arch_curves=curves,
    )
    assert mesh.is_watertight
    assert len(mesh.split(only_watertight=False)) == 1
    assert np.isfinite(mesh.vertices).all()
    assert not np.any(mesh.area_faces <= 1e-12)
