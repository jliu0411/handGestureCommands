from io import BytesIO

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

IMAGE_TYPES = {"image/jpeg": "JPEG", "image/png": "PNG"}
MAX_PIXELS = 12_000_000


def decode_image(content, content_type=None):
    try:
        with Image.open(BytesIO(content), formats=list(IMAGE_TYPES.values())) as image:
            if content_type and image.format != IMAGE_TYPES.get(content_type):
                raise ValueError("Image format does not match Content-Type")
            if image.width * image.height > MAX_PIXELS:
                raise ValueError("Image exceeds 12 megapixels")
            image = ImageOps.exif_transpose(image).convert("RGB")
            return cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as exc:
        raise ValueError("Invalid JPEG or PNG image") from exc
