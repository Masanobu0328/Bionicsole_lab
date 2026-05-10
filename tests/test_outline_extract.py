from __future__ import annotations

import io
import math

from PIL import Image, ImageDraw
from scipy.spatial import ConvexHull

from core.outline_extract import extract_outline_from_image


def _fixture_image(with_guides: bool = True) -> io.BytesIO:
    image = Image.new("RGB", (520, 320), "white")
    draw = ImageDraw.Draw(image)

    if with_guides:
        draw.line([(40, 30), (480, 290)], fill=(40, 40, 40), width=2)
        draw.line([(80, 270), (470, 270)], fill=(40, 40, 40), width=2)

    foot = [
        (100, 160),
        (135, 110),
        (230, 75),
        (350, 78),
        (430, 118),
        (455, 160),
        (420, 205),
        (320, 230),
        (195, 220),
        (125, 195),
    ]
    draw.polygon(foot, fill=(15, 15, 15))

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return buffer


def test_extract_outline_returns_requested_closed_scaled_points() -> None:
    result = extract_outline_from_image(_fixture_image(), target_length_mm=260.0, num_points=64)
    points = result.outline_points

    assert len(points) == 64

    x_values = [point["x"] for point in points]
    assert math.isclose(min(x_values), 0.0, rel_tol=0.0, abs_tol=1e-6)
    assert math.isclose(max(x_values) - min(x_values), 260.0, rel_tol=0.0, abs_tol=1e-6)

    segment_lengths = [
        math.dist(
            (points[i]["x"], points[i]["y"]),
            (points[(i + 1) % len(points)]["x"], points[(i + 1) % len(points)]["y"]),
        )
        for i in range(len(points))
    ]
    assert segment_lengths[-1] < (sum(segment_lengths) / len(segment_lengths)) * 2.5
    assert result.preview_png.startswith("data:image/png;base64,")


def test_extract_outline_ignores_disconnected_guide_lines() -> None:
    clean = extract_outline_from_image(_fixture_image(with_guides=False), 260.0, 80).outline_points
    guided = extract_outline_from_image(_fixture_image(with_guides=True), 260.0, 80).outline_points

    clean_area = ConvexHull([(point["x"], point["y"]) for point in clean]).volume
    guided_area = ConvexHull([(point["x"], point["y"]) for point in guided]).volume

    assert math.isclose(guided_area, clean_area, rel_tol=0.12)
