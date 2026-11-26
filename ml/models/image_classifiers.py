"""PyTorch models for the image-based gesture experiments."""

from torch import nn
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small


ARCHITECTURES = ("cnn", "mobilenet_v3_small")
MOBILENET_WEIGHTS = MobileNet_V3_Small_Weights.IMAGENET1K_V1


class GestureCNN(nn.Module):
    def __init__(self, num_classes):
        super().__init__()
        layers = []
        for in_channels, out_channels in ((3, 24), (24, 48), (48, 96)):
            layers.extend((
                nn.Conv2d(in_channels, out_channels, 3, padding=1, bias=False),
                nn.BatchNorm2d(out_channels),
                nn.ReLU(inplace=True),
                nn.MaxPool2d(2),
            ))
        self.features = nn.Sequential(*layers)
        self.classifier = nn.Sequential(
            nn.AdaptiveAvgPool2d((4, 4)),
            nn.Flatten(),
            nn.Dropout(0.25),
            nn.Linear(96 * 4 * 4, num_classes),
        )

    def forward(self, images):
        return self.classifier(self.features(images))


def build_image_model(architecture, num_classes, *, pretrained=False):
    """Build a classifier. Enable pretrained weights for new MobileNet runs."""
    if architecture == "cnn":
        if pretrained:
            raise ValueError("Pretrained weights are only available for MobileNet")
        return GestureCNN(num_classes)

    if architecture == "mobilenet_v3_small":
        weights = MOBILENET_WEIGHTS if pretrained else None
        model = mobilenet_v3_small(weights=weights)
        model.classifier[-1] = nn.Linear(model.classifier[-1].in_features, num_classes)
        return model

    raise ValueError(f"Unknown image classifier architecture: {architecture}")
