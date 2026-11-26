# Landmark-based Random Forest baseline

Verified on Apple M1, macOS 15.2, and Python 3.11.2. The run used seed 42
and selected a 300-tree Random Forest. The saved artifact and both evaluation
reports identify model `4a55f8c0de364be8b68e319047af2811`.

## Reproduce training and evaluation

Run from the repository root in a Python 3.11 environment with
`backend/requirements.txt` installed.

```bash
run=".cache/issue-5"
python -m ml.preprocessing.prepare \
  --hagrid-subset 100 --output "$run/data" &&
python -m ml.training.train_random_forest \
  --data "$run/data/landmarks.csv" --model "$run/random_forest.joblib" \
  --output "$run/metrics/validation" --figures "$run/figures" &&
python -m ml.evaluation.evaluate \
  --data "$run/data/landmarks.csv" --model "$run/random_forest.joblib" \
  --output "$run/metrics/test" --figures "$run/figures"

```

## Evaluation results

The checked-in reference metrics and the Apple M1 reproduction use different
model IDs and split counts. Each row reports the results for its own run.

| Run | Split | Images | Accuracy | Macro F1 |
| --- | --- | ---: | ---: | ---: |
| Checked-in reference | Validation | 83 | 96.39% | 96.14% |
| Checked-in reference | Test | 79 | 100.00% | 100.00% |
| Apple M1 reproduction | Validation | 85 | 100.00% | 100.00% |
| Apple M1 reproduction | Test | 76 | 98.68% | 99.04% |

The checked-in metrics identify model `51920f4eaeac4db0bc1bf58c2f5fa192`.
The Apple M1 evaluation reports and latency benchmark identify model
`4a55f8c0de364be8b68e319047af2811`.

## Inference latency

On an Apple M1 running macOS 15.2 and Python 3.11.2, `GestureService.predict`
took **58.301 ms median** and **151.138 ms p95** across 85 timed predictions
after 10 warmups. The benchmark started with decoded validation images and
excluded image decoding and HTTP overhead.

At a confidence threshold of 0.70, the service returned 82 gesture labels,
3 `unknown` responses, and 0 `no_hand` responses. These counts describe
service outcomes. The evaluation table reports classification accuracy.