import numpy as np
import pytest

from ml.inference.finger_count import FINGERS, count_fingers


def hand(count):
    points = [[0, 0, 0]]
    if count == 5:
        points += [[-.25, .24, 0], [-.49, .41, 0], [-.73, .58, 0], [-.97, .75, 0]]
    else:
        points += [[-.25, .24, 0], [-.51, .49, .1], [-.26, .64, .15], [-.03, .72, .14]]
    for index, (x, y) in enumerate([(-.43, 1), (-.15, 1.1), (.15, 1.05), (.45, .9)], start=1):
        points.append([x, y, 0])
        if index <= count:
            points += [[x, y+.32, 0], [x, y+.55, 0], [x, y+.72, 0]]
        else:
            points += [[x, y+.28, .04], [x, y+.25, .25], [x, y+.08, .30]]
    return np.array(points)


def image(points):
    return points[:, :2] * .2 + .5


@pytest.mark.parametrize("count", range(6))
@pytest.mark.parametrize("mirror", (1, -1))
@pytest.mark.parametrize("angle", (0, np.pi/2, np.pi))
def test_counts_are_invariant_to_handedness_reflection_and_rotation(count, mirror, angle):
    points = hand(count)
    c, s = np.cos(angle), np.sin(angle)
    points[:, 0] *= mirror
    points = points @ np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    states = count_fingers(points, image(points))
    assert states == {name: (count == 5 if index == 0 else index <= count)
                      for index, name in enumerate(FINGERS)}


def test_rejects_cropped_small_or_missing_hands():
    points = hand(5)
    assert count_fingers(points, image(points) + [0, .15]) is None
    assert count_fingers(points, points[:, :2] * .025 + .5) is None
    assert count_fingers(points[:-1], image(points[:-1])) is None
    points[5] = np.nan
    assert count_fingers(points, image(points)) is None


def test_treats_half_bent_finger_as_ambiguous():
    points = hand(5)
    points[7] = points[6] + [.14, .14, 0]
    points[8] = points[7] + [.12, .12, 0]
    assert count_fingers(points, image(points)) is None


@pytest.mark.parametrize("count,tip", [(1, 8), (2, 12)])
@pytest.mark.parametrize("mirror", (1, -1))
def test_accepts_a_scroll_finger_with_strong_reach_and_a_mild_distal_bend(count, tip, mirror):
    points = hand(count)
    points[tip] = points[tip - 1] + [.10, .12, 0]
    points[:, 0] *= mirror
    assert count_fingers(points, image(points)) == {name: 0 < i <= count for i, name in enumerate(FINGERS)}


@pytest.mark.parametrize("count,tip", [(1, 8), (2, 12)])
def test_keeps_a_forward_reaching_finger_uncertain_when_it_has_a_sharp_distal_bend(count, tip):
    points = hand(count)
    points[tip] = points[tip - 1] + [.17, .06, 0]
    assert count_fingers(points, image(points)) is None


def test_mild_distal_bend_allowance_does_not_apply_to_link_or_back_poses():
    for count in (3, 4, 5):
        points = hand(count)
        points[8] = points[7] + [.10, .12, 0]
        assert count_fingers(points, image(points)) is None


@pytest.mark.parametrize("count", (0, 1, 2))
def test_distinguishes_an_extended_thumb_from_a_folded_thumb(count):
    points = hand(count)
    points[1:5] = [[-.34, .19, .03], [-.62, .38, .08], [-.60, .53, .18], [-.50, .68, .25]]
    assert count_fingers(points, image(points)) == {name: 0 < i <= count for i, name in enumerate(FINGERS)}
    points[1:5] = hand(5)[1:5]
    assert count_fingers(points, image(points)) == {name: i <= count for i, name in enumerate(FINGERS)}
