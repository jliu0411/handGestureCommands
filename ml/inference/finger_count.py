"""Conservative open/folded rules for one complete MediaPipe hand."""

import numpy as np

FINGERS = ("thumb", "index", "middle", "ring", "pinky")


def _angle(a, joint, b):
    left, right = a - joint, b - joint
    cosine = np.dot(left, right) / (np.linalg.norm(left) * np.linalg.norm(right))
    return float(np.degrees(np.arccos(np.clip(cosine, -1, 1))))


def count_fingers(points, image_xy):
    """Return named states when every digit can be resolved, otherwise None.

    Points have aspect-corrected XYZ coordinates. Image XY retains the normalized
    image bounds so cropped landmarks can be rejected before pose evaluation.
    """
    points = np.asarray(points)
    image_xy = np.asarray(image_xy)
    if (points.shape != (21, 3) or image_xy.shape != (21, 2)
            or not np.isfinite(points).all() or not np.isfinite(image_xy).all()
            or (image_xy < 0.015).any() or (image_xy > 0.985).any()
            or np.ptp(image_xy, axis=0).max() < 0.11):
        return None

    wrist, index_mcp, pinky_mcp = points[[0, 5, 17]]
    across = index_mcp - pinky_mcp
    width = np.linalg.norm(across)
    length = np.linalg.norm(points[9] - wrist)
    if min(width, length) < 1e-6 or np.linalg.norm(across[:2]) < 0.28 * length:
        return None
    chains = points[1:].reshape(5, 4, 3)
    segments = np.linalg.norm(np.diff(chains, axis=1), axis=2)
    if (segments < 0.035 * length).any() or (segments > 1.15 * length).any():
        return None

    palm_axis = (points[9] - wrist) / length
    states = {}
    borderline = []
    for name, (base, pip, dip, tip) in zip(FINGERS[1:], chains[1:]):
        pip_angle = _angle(base, pip, dip)
        dip_angle = _angle(pip, dip, tip)
        reach = (np.linalg.norm(tip - wrist) - np.linalg.norm(pip - wrist)) / length
        forward = np.dot(tip - pip, palm_axis) / length
        if pip_angle >= 150 and dip_angle >= 145 and reach >= 0.13:
            states[name] = True
        elif (name in ("index", "middle") and pip_angle >= 155 and dip_angle >= 128
              and reach >= 0.22 and forward >= 0.20):
            borderline.append(name)
        elif pip_angle <= 125 or dip_angle <= 115 or reach <= -0.03:
            # Bent distal geometry can disagree with strong fingertip extension.
            # Leave a borderline pointing finger unresolved instead of reporting a fist.
            if pip_angle >= 125 and reach >= 0.13 and forward >= 0.12:
                return None
            states[name] = False
        else:
            return None

    if borderline and (states["ring"] or states["pinky"]):
        return None
    states.update(dict.fromkeys(borderline, True))

    cmc, mcp, ip, tip = chains[0]
    thumb_ip = _angle(mcp, ip, tip)
    thumb_mcp = _angle(cmc, mcp, ip)
    separation = np.linalg.norm(tip - index_mcp) / width
    outward = np.dot(tip - index_mcp, across) / width**2
    thumb_extended = thumb_ip >= 145 and thumb_mcp >= 135 and outward >= 0.25 and separation >= 0.55
    thumb_tucked = thumb_ip <= 125 or thumb_mcp <= 110 or outward <= 0.04 or separation <= 0.40
    if (not states["ring"] and not states["pinky"] and outward <= 0.12
            and np.dot(tip - index_mcp, palm_axis) <= 0.30 * length
            and (thumb_ip <= 140 or thumb_mcp <= 130)):
        thumb_tucked = True
    if not (thumb_extended or thumb_tucked):
        return None
    states["thumb"] = thumb_extended
    return {name: states[name] for name in FINGERS}
