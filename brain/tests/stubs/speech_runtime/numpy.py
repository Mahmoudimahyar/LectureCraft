"""LABELLED STUB: this is NOT numpy.

Just enough of an array for the real speech worker's control flow to run in tests without a speech runtime: a flat
list with slicing, slice assignment, ``sum``, ``all``, ``reshape`` and ``astype``. Nothing here does arithmetic on
audio. It is importable only when a test puts this folder on the import path (see ``real_worker_with_stubs.py``).
"""
from __future__ import annotations

import math

LABELLED_STUB = True
float32, bool_ = "float32", "bool"


class Array:
    def __init__(self, values):
        self.values = list(values)

    def __len__(self) -> int:
        return len(self.values)

    def __getitem__(self, key):
        return Array(self.values[key]) if isinstance(key, slice) else self.values[key]

    def __setitem__(self, key, value) -> None:
        if not isinstance(key, slice):
            self.values[key] = value
            return
        count = len(range(*key.indices(len(self.values))))
        new = list(value.values) if isinstance(value, Array) else [value] * count
        if len(new) != count:
            raise ValueError("LABELLED STUB numpy: a slice is assigned exactly as many values as it holds")
        self.values[key] = new

    def sum(self):
        return sum(self.values)

    def all(self) -> bool:
        return all(self.values)

    def reshape(self, *shape):
        return self

    def astype(self, dtype, copy: bool = True):
        return self


def zeros(count: int, dtype=None) -> Array:
    return Array([False] * count if dtype == bool_ else [0.0] * count)


def isfinite(array: Array) -> Array:
    return Array(math.isfinite(value) for value in array.values)
