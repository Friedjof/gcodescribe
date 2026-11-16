"""Independent counterexamples and geometric invariants for the planning prototype."""

import math
from itertools import permutations

from demo import covered, difference, exact_union, fixtures, ink, stroke
from shapely.affinity import rotate, translate

checks = 0
original = fixtures()[0][3]
reference = ink(original, 0.4)
for order in permutations(original):
    candidate = exact_union(list(order))
    delta = difference(reference, ink(candidate, 0.4))
    assert max(delta["missing_mm2"], delta["added_mm2"]) < 1e-7
    checks += 1

# Sequential deletion cannot let mutually covering paths all disappear.
identical = [stroke([(0, 0), (10, 0)])] * 3
result = covered(identical, 0.4)
assert len(result) == 1
assert ink(result, 0.4).symmetric_difference(ink(identical, 0.4)).area < 1e-9
checks += 1

# A protected duplicate remains even when it has no unique geometric coverage.
protected = stroke([(0, 0), (10, 0)], True)
result = covered([protected, *identical], 0.4)
assert result == [protected]
checks += 1

# Rotating/translating the source does not rotate or scale the circular nib.
line = stroke([(0, 0), (5, 0), (5, 3)])
angle = 0.73
transformed = stroke(
    [
        (
            12 + x * math.cos(angle) - y * math.sin(angle),
            20 + x * math.sin(angle) + y * math.cos(angle),
        )
        for x, y in line.points
    ]
)
expected = translate(rotate(ink([line], 0.4), angle, origin=(0, 0), use_radians=True), 12, 20)
assert expected.symmetric_difference(ink([transformed], 0.4)).area < 1e-6
checks += 1

# Verify measured area-loss conclusions are insensitive to the polygon precision.
a, b = fixtures()[3][3]
values = []
for q in (16, 32, 64):
    left, right = a.geometry.buffer(0.2, quad_segs=q), b.geometry.buffer(0.2, quad_segs=q)
    full = left.union(right)
    values.append(100 * full.difference(left).area / full.area)
assert min(values) > 23 and max(values) - min(values) < 0.01
checks += 1
print(f"{checks} additional invariant checks passed")
