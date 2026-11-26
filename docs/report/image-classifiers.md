# Image-based gesture classifiers

The custom CNN and MobileNetV3 Small used the same accepted HaGRID images and
subject-disjoint splits as the Apple M1 [Random Forest reproduction](landmark-baseline.md).
The six-class dataset contains 318 training, 85 validation, and 76 held-out test
images. Checkpoints were selected by validation macro F1, with validation
accuracy as the tiebreaker.

| Model | Selected epoch | Val accuracy | Val macro F1 | Test accuracy | Test macro F1 | Checkpoint (bytes) | Median (ms) | p95 (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Random Forest | — | 100.00% | 100.00% | 98.68% | 99.04% | 218,359 | 58.301 | 151.138 |
| Custom CNN | 11 | 24.71% | 24.72% | 18.42% | 16.71% | 256,821 | 17.714 | 27.462 |
| MobileNetV3 Small | 19 | 43.53% | 46.63% | 36.84% | 37.10% | 6,218,821 | 26.126 | 30.076 |

MobileNet led the image models on the held-out split. At its selected epoch,
training loss fell to 0.0144 while validation loss reached 2.6926, indicating
overfitting.

Each Apple M1 benchmark timed 85 single-image predictions after 10 warmups.
Timing began with decoded validation images and included each model's input
processing. The image models used one PyTorch CPU thread. The Random Forest
used `GestureService.predict`, which includes MediaPipe and can also compute
finger states. Classification scores use the top class. The latency runs apply
a 0.70 confidence threshold.

## Training configuration

Both image models used 20 epochs, batch size 16, seed 42, cross-entropy loss,
and AdamW with weight decay `1e-4`. The CNN trained from scratch at learning
rate `1e-3`. MobileNet fine-tuned all layers from `IMAGENET1K_V1` weights at
`3e-4`. Inputs were resized with aspect ratio preserved, padded to 224 × 224,
and normalized with ImageNet statistics. Only training applied horizontal
flips and brightness and contrast jitter.

## Reproduce the image runs

Prepare `.cache/issue-5/data` using the linked baseline instructions. From a
Python 3.11 environment with `ml/requirements-image.txt` installed, run:

```bash
for model in cnn mobilenet_v3_small; do
  run=".cache/issue-6/full/$model"
  data=(--manifest .cache/issue-5/data/manifest.csv --images datasets/raw/hagrid-export_100_images)
  python -m ml.training.train_image_classifier "${data[@]}" \
    --model "$model" --output "$run" --epochs 20 --batch-size 16 --seed 42 --device cpu &&
  python -m ml.evaluation.evaluate_image_classifier "${data[@]}" --run "$run" &&
  python -m ml.evaluation.benchmark_image_classifier "${data[@]}" --run "$run" || break
done
```

- Custom CNN [curves](../../artifacts/figures/image-classifiers/cnn.png), [history](../../artifacts/metrics/image-classifiers/cnn/history.json), [evaluation](../../artifacts/metrics/image-classifiers/cnn/evaluation.json), and [latency](../../artifacts/metrics/image-classifiers/cnn/inference_latency.json).
- MobileNetV3 Small [curves](../../artifacts/figures/image-classifiers/mobilenet_v3_small.png), [history](../../artifacts/metrics/image-classifiers/mobilenet_v3_small/history.json), [evaluation](../../artifacts/metrics/image-classifiers/mobilenet_v3_small/evaluation.json), and [latency](../../artifacts/metrics/image-classifiers/mobilenet_v3_small/inference_latency.json).
