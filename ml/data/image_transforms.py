"""Shared input transforms for gesture image classifiers."""

from PIL import Image, ImageOps
from torchvision import transforms


IMAGE_SIZE = 224
IMAGE_MEAN = (0.485, 0.456, 0.406)
IMAGE_STD = (0.229, 0.224, 0.225)
PADDING_COLOR = tuple(round(255 * channel) for channel in IMAGE_MEAN)


def resize_and_pad(image):
    return ImageOps.pad(
        image,
        (IMAGE_SIZE, IMAGE_SIZE),
        method=Image.Resampling.BILINEAR,
        color=PADDING_COLOR,
    )


def build_image_transform(*, training=False):
    steps = []
    if training:
        steps.extend((
            transforms.RandomHorizontalFlip(p=0.5),
            transforms.ColorJitter(brightness=0.15, contrast=0.15),
        ))
    steps.extend((
        resize_and_pad,
        transforms.ToTensor(),
        transforms.Normalize(mean=IMAGE_MEAN, std=IMAGE_STD),
    ))
    return transforms.Compose(steps)
