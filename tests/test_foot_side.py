"""Which foot gets mirrored, and that the two sides stay exact mirrors.

Printed parts came out swapped: the file labelled right was a left insole.
The engine builds one mesh and the orientation step flips the whole of it, so
the two sides are always mirror images - what was wrong was only which name
each got. These pin the side, so it cannot drift back unnoticed.
"""
from __future__ import annotations

import numpy as np
import pytest
import trimesh

from backend.api.endpoints import MIRRORED_FOOT_SIDE, apply_foot_side_orientation


def lopsided_mesh():
    """A wedge with a clear high side, so a y-mirror is unmistakable."""
    mesh = trimesh.creation.box(extents=(40.0, 20.0, 4.0))
    high = mesh.vertices[:, 1] > 0
    mesh.vertices[high, 2] += 6.0
    return mesh


def tall_side_sign(mesh):
    """+1 when the tall side sits at high y, -1 when it sits at low y."""
    top = mesh.vertices[:, 2] > mesh.vertices[:, 2].mean()
    return 1.0 if mesh.vertices[top, 1].mean() > mesh.vertices[:, 1].mean() else -1.0


def test_the_right_foot_is_the_mirrored_one():
    assert MIRRORED_FOOT_SIDE == "right", (
        "the outline is the left-foot reference, so right is the side that "
        "gets mirrored; flipping this swaps every printed insole"
    )


def test_right_is_mirrored_and_left_is_not():
    left, right = lopsided_mesh(), lopsided_mesh()
    assert apply_foot_side_orientation(left, "left") is False
    assert apply_foot_side_orientation(right, "right") is True
    assert tall_side_sign(left) == -tall_side_sign(right)


def test_the_two_sides_are_exact_mirrors():
    """Whatever the arch does on one foot, it must do mirrored on the other."""
    left, right = lopsided_mesh(), lopsided_mesh()
    apply_foot_side_orientation(left, "left")
    apply_foot_side_orientation(right, "right")

    flipped_back = right.copy()
    y_min, y_max = flipped_back.vertices[:, 1].min(), flipped_back.vertices[:, 1].max()
    flipped_back.apply_transform(np.array([
        [1, 0, 0, 0], [0, -1, 0, y_min + y_max], [0, 0, 1, 0], [0, 0, 0, 1],
    ], dtype=float))

    a = np.array(sorted(map(tuple, np.round(left.vertices, 6))))
    b = np.array(sorted(map(tuple, np.round(flipped_back.vertices, 6))))
    assert np.allclose(a, b), "the two feet are no longer mirror images"


def test_mirroring_keeps_the_footprint_in_place():
    """Mirroring about the mesh's own y-centre must not move or resize it."""
    mesh = lopsided_mesh()
    before = mesh.bounds.copy()
    volume_before = mesh.volume
    apply_foot_side_orientation(mesh, "right")
    assert np.allclose(mesh.bounds, before)
    assert mesh.volume == pytest.approx(volume_before)


@pytest.mark.parametrize("side", ["left", "Right", "RIGHT", "", "both"])
def test_only_the_exact_side_string_mirrors(side):
    mesh = lopsided_mesh()
    sign_before = tall_side_sign(mesh)
    apply_foot_side_orientation(mesh, side)
    assert tall_side_sign(mesh) == sign_before
