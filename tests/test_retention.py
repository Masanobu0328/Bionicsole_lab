"""The retention rule must never take the newest generation, whatever its age."""
from __future__ import annotations

import pytest

from backend.api.retention import find_prunable_jobs, prune_generations


class FakeQuery:
    def __init__(self, rows, store):
        self._rows = rows
        self._store = store
        self._filters = {}
        self._desc = False

    def select(self, *_):
        return self

    def eq(self, column, value):
        self._filters[column] = value
        return self

    def order(self, column, desc=False):
        self._desc = desc
        self._column = column
        return self

    def update(self, values):
        self._store.updates.append((dict(self._filters), values))
        return self

    def execute(self):
        rows = [r for r in self._rows
                if all(r.get(k) == v for k, v in self._filters.items())]
        rows.sort(key=lambda r: r["created_at"], reverse=self._desc)
        return type("Result", (), {"data": rows})()


class FakeStorage:
    def __init__(self, store):
        self._store = store

    def remove(self, paths):
        self._store.removed.extend(paths)
        return [{"name": p} for p in paths]


class FakeSupabase:
    def __init__(self, rows):
        self.rows = rows
        self.removed = []
        self.updates = []

    def table(self, _):
        return FakeQuery(self.rows, self)

    @property
    def storage(self):
        outer = self

        class _S:
            def from_(self, _bucket):
                return FakeStorage(outer)

        return _S()


def make_rows(n, patient="p1", side="right", start_day=1):
    return [
        {
            "id": f"{patient}-{side}-{i}",
            "patient_id": patient,
            "foot_side": side,
            "created_at": f"2026-01-{start_day + i:02d}T00:00:00Z",
            "glb_storage_path": f"u/{patient}_{side}_{i}.glb",
            "stl_storage_path": f"u/{patient}_{side}_{i}.stl",
        }
        for i in range(n)
    ]


def test_keeps_the_newest_n_and_prunes_the_rest():
    client = FakeSupabase(make_rows(25))
    result = prune_generations(client, "p1", "right", keep=10)

    assert result == {"jobs": 15, "files": 30}
    assert len(client.removed) == 30
    # The ten newest are days 16..25, i.e. indices 15..24.
    for i in range(15, 25):
        assert f"u/p1_right_{i}.glb" not in client.removed
    for i in range(0, 15):
        assert f"u/p1_right_{i}.glb" in client.removed


def test_a_single_old_generation_survives():
    """A patient seen once, long ago, must not lose their only insole."""
    client = FakeSupabase(make_rows(1))
    assert prune_generations(client, "p1", "right", keep=10) == {"jobs": 0, "files": 0}
    assert client.removed == []


@pytest.mark.parametrize("count", [1, 5, 10])
def test_nothing_to_do_at_or_under_the_limit(count):
    client = FakeSupabase(make_rows(count))
    assert prune_generations(client, "p1", "right", keep=10)["files"] == 0


def test_sides_are_counted_separately():
    client = FakeSupabase(make_rows(6) + make_rows(6, side="left"))
    assert prune_generations(client, "p1", "right", keep=5)["jobs"] == 1
    assert all("_left_" not in p for p in client.removed)


def test_rows_already_pruned_are_not_reported_again():
    rows = make_rows(12)
    for row in rows[:2]:
        row["glb_storage_path"] = None
        row["stl_storage_path"] = None
    client = FakeSupabase(rows)
    # 12 rows, keep 10 -> the 2 oldest are candidates, but both are already bare.
    assert find_prunable_jobs(client, "p1", "right", keep=10) == []


def test_dry_run_touches_nothing():
    client = FakeSupabase(make_rows(25))
    result = prune_generations(client, "p1", "right", keep=10, dry_run=True)
    assert result == {"jobs": 15, "files": 30}
    assert client.removed == []
    assert client.updates == []


def test_paths_are_cleared_so_no_row_claims_a_missing_file():
    client = FakeSupabase(make_rows(12))
    prune_generations(client, "p1", "right", keep=10)
    assert len(client.updates) == 2
    for _, values in client.updates:
        assert values == {"glb_storage_path": None, "stl_storage_path": None}
