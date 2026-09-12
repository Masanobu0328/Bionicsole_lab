"""The export routes must not hand patient geometry to anonymous callers.

Export filenames are built from the patient code (generated_P-0001_right.glb),
so anything here that answers without a token is guessable from the code alone.
Production served exactly that for months through a StaticFiles mount, which
quietly undid the private buckets and signed URLs covering the same meshes.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_static_exports_mount_is_gone():
    """The old open mount answered /exports/<name> with the mesh itself."""
    response = client.get("/exports/generated_P-0001_right.glb")
    assert response.status_code == 404, (
        "the exports directory is being served statically again - "
        "that route needs no token and its names follow the patient code"
    )


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/exports/generated_P-0001_right.glb",
        "/api/v1/exports/generated_P-0001_right.stl",
        "/api/v1/patients",
    ],
)
def test_requires_a_token(path):
    assert client.get(path).status_code == 401


def test_rejects_a_bearer_that_is_not_one():
    response = client.get(
        "/api/v1/exports/generated_P-0001_right.glb",
        headers={"Authorization": "Basic hunter2"},
    )
    assert response.status_code == 401


@pytest.mark.parametrize(
    "filename",
    ["../backend/.env", "..%2F..%2Fbackend%2F.env", "....//backend/.env"],
)
def test_does_not_climb_out_of_the_exports_directory(filename):
    """Never 200, whether it is turned away for the token or for the path."""
    response = client.get(f"/api/v1/exports/{filename}")
    assert response.status_code in (401, 404)
