from __future__ import annotations

import base64
import io
from dataclasses import dataclass
from typing import BinaryIO, List, Tuple

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.ndimage import gaussian_filter1d
from skimage import color, filters, measure, morphology


Point = dict[str, float]


@dataclass(frozen=True)
class ExtractedOutline:
    outline_points: List[Point]
    preview_png: str


def extract_outline_from_image(
    image_file: BinaryIO,
    target_length_mm: float,
    num_points: int = 120,
    auto_orient: bool = False,
) -> ExtractedOutline:
    if target_length_mm <= 0:
        raise ValueError("target_length_mm must be positive")
    if num_points < 8:
        raise ValueError("num_points must be at least 8")

    image = _load_image(image_file)
    gray = color.rgb2gray(image)
    blurred = filters.gaussian(gray, sigma=2, preserve_range=True)

    threshold = filters.threshold_otsu(blurred)
    dark_foreground = blurred < threshold
    light_foreground = blurred > threshold
    foreground = dark_foreground if dark_foreground.mean() < light_foreground.mean() else light_foreground

    foreground = morphology.binary_closing(foreground, morphology.disk(5))
    foreground = ndimage.binary_fill_holes(foreground)
    component = _largest_component(foreground)

    contours = measure.find_contours(component.astype(float), level=0.5)
    if not contours:
        raise ValueError("No outline contour was detected")

    contour = max(contours, key=len)
    smoothed = np.column_stack([
        gaussian_filter1d(contour[:, 1], sigma=3, mode="wrap"),
        gaussian_filter1d(contour[:, 0], sigma=3, mode="wrap"),
    ])

    resampled = _resample_closed_curve(smoothed, num_points)
    normalized = _normalize_to_foot_coordinates(
        resampled,
        target_length_mm,
        auto_orient=auto_orient,
    )
    preview = _build_preview_png(image, contour)

    return ExtractedOutline(
        outline_points=[{"x": float(x), "y": float(y)} for x, y in normalized],
        preview_png=preview,
    )


def _load_image(image_file: BinaryIO) -> np.ndarray:
    with Image.open(image_file) as image:
        image = image.convert("RGB")
        width, height = image.size
        longest = max(width, height)
        if longest > 1500:
            scale = 1500 / longest
            next_size = (max(1, round(width * scale)), max(1, round(height * scale)))
            image = image.resize(next_size, Image.Resampling.LANCZOS)
        return np.asarray(image, dtype=np.float32) / 255.0


def _largest_component(mask: np.ndarray) -> np.ndarray:
    labels = measure.label(mask)
    regions = measure.regionprops(labels)
    if not regions:
        raise ValueError("No foreground component was detected")

    largest = max(regions, key=lambda region: region.area)
    if largest.area < 25:
        raise ValueError("Detected foreground component is too small")
    return labels == largest.label


def _resample_closed_curve(points: np.ndarray, num_points: int) -> np.ndarray:
    closed = np.vstack([points, points[0]])
    segment_lengths = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    perimeter = float(segment_lengths.sum())
    if perimeter <= 0:
        raise ValueError("Detected outline contour has zero perimeter")

    cumulative = np.concatenate([[0.0], np.cumsum(segment_lengths)])
    targets = np.linspace(0.0, perimeter, num_points, endpoint=False)
    x = np.interp(targets, cumulative, closed[:, 0])
    y = np.interp(targets, cumulative, closed[:, 1])
    return np.column_stack([x, y])


def _normalize_to_foot_coordinates(
    points: np.ndarray,
    target_length_mm: float,
    auto_orient: bool,
) -> np.ndarray:
    if auto_orient:
        centered = points - points.mean(axis=0)
        _, _, vt = np.linalg.svd(centered, full_matrices=False)
        axis_x = vt[0]
        axis_y = np.array([-axis_x[1], axis_x[0]])
        aligned = np.column_stack([centered @ axis_x, centered @ axis_y])

        x_min = float(aligned[:, 0].min())
        x_max = float(aligned[:, 0].max())
        length = x_max - x_min
        if length <= 0:
            raise ValueError("Detected outline has zero length")

        left_width = _edge_width(aligned, x_min, length, edge="left")
        right_width = _edge_width(aligned, x_min, length, edge="right")
        if left_width > right_width:
            aligned[:, 0] *= -1
    else:
        aligned = points.copy()

    aligned[:, 0] -= aligned[:, 0].min()
    aligned[:, 1] -= aligned[:, 1].min()
    length = float(aligned[:, 0].max())
    if length <= 0:
        raise ValueError("Detected outline has zero length")

    scale = target_length_mm / length
    normalized = aligned * scale

    start_index = int(np.argmin(normalized[:, 0]))
    return np.vstack([normalized[start_index:], normalized[:start_index]])


def _edge_width(points: np.ndarray, x_min: float, length: float, edge: str) -> float:
    if edge == "left":
        selected = points[:, 0] <= x_min + length * 0.15
    else:
        selected = points[:, 0] >= x_min + length * 0.85
    edge_points = points[selected]
    if len(edge_points) < 2:
        return 0.0
    return float(edge_points[:, 1].max() - edge_points[:, 1].min())


def _build_preview_png(image: np.ndarray, contour: np.ndarray) -> str:
    preview_image = Image.fromarray(np.clip(image * 255, 0, 255).astype(np.uint8)).convert("RGBA")
    overlay = Image.new("RGBA", preview_image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    xy: List[Tuple[float, float]] = [(float(col), float(row)) for row, col in contour]
    if len(xy) > 1:
        draw.line(xy + [xy[0]], fill=(20, 184, 166, 255), width=4)
    composed = Image.alpha_composite(preview_image, overlay)

    buffer = io.BytesIO()
    composed.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"
