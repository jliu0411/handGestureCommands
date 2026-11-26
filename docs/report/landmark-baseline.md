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