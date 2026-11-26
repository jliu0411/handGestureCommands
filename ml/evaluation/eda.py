import argparse
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd


def main():
    parser = argparse.ArgumentParser(description="Audit gesture preprocessing outcomes.")
    parser.add_argument(
        "--manifest", type=Path, default=Path("datasets/processed/manifest.csv")
    )
    parser.add_argument(
        "--figures", type=Path, default=Path("artifacts/figures/eda")
    )
    args = parser.parse_args()

    manifest = pd.read_csv(args.manifest, dtype=str, keep_default_na=False)
    outcomes = pd.crosstab(manifest["label"], manifest["status"])
    outcomes = outcomes.reindex(
        columns=["ok", "no_hand", "wrong_hand", *(
            column for column in outcomes.columns
            if column not in {"ok", "no_hand", "wrong_hand"}
        )],
        fill_value=0,
    )

    report = outcomes.copy()
    report["candidates"] = outcomes.sum(axis=1)
    report["retained_pct"] = (
        100 * report["ok"] / report["candidates"]
    ).round(1)
    print(report.to_string())

    retained = manifest.loc[manifest["status"].eq("ok")].copy()
    print("\nRetained images by gesture and split")
    print(pd.crosstab(retained["label"], retained["split"]).to_string())

    retained["subject_id"] = retained["subject_id"].str.strip()
    identified = retained.loc[retained["subject_id"].ne("")]
    splits_per_subject = identified.groupby("subject_id")["split"].nunique()

    print(f"\nRetained rows missing a subject ID: {len(retained) - len(identified)}")
    print(f"Retained rows missing a split: {retained['split'].eq('').sum()}")
    print(f"Subjects in multiple splits: {splits_per_subject.gt(1).sum()}")

    args.figures.mkdir(parents=True, exist_ok=True)
    ax = outcomes.rename(columns={
        "ok": "Retained",
        "no_hand": "No hand detected",
        "wrong_hand": "Target-hand mismatch",
    }).plot.barh(stacked=True, figsize=(9, 5))
    ax.set(
        title="HaGRIDv2 preprocessing outcomes by gesture",
        xlabel="Candidate images",
        ylabel="Gesture",
    )
    output = args.figures / "preprocessing_outcomes.png"
    figure = ax.get_figure()
    figure.savefig(output, dpi=180, bbox_inches="tight")
    plt.close(figure)
    split_counts = pd.crosstab(retained["label"], retained["split"]).reindex(
        columns=["train", "val", "test"], fill_value=0
    )
    split_counts = split_counts.rename(
        columns={"train": "Train", "val": "Validation", "test": "Test"}
    )

    ax = split_counts.plot.bar(figsize=(9, 5), rot=0)
    ax.set(
        title="Retained images by gesture and split",
        xlabel="Gesture",
        ylabel="Retained images",
    )
    for bars in ax.containers:
        ax.bar_label(bars, fontsize=8, padding=2)
    ax.margins(y=0.12)

    figure = ax.get_figure()
    output = args.figures / "retained_class_counts_by_split.png"
    figure.savefig(output, dpi=180, bbox_inches="tight")
    plt.close(figure)
    print(f"Saved {output}")


if __name__ == "__main__":
    main()
