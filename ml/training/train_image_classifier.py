"""Train one image classifier and save the best validation checkpoint."""

import argparse
import hashlib
import json
from pathlib import Path

import torch
from sklearn.metrics import accuracy_score, f1_score
from torch import nn
from torch.utils.data import DataLoader

from ml.data.image_dataset import GestureImageDataset, load_image_splits
from ml.data.image_transforms import build_image_transform
from ml.models.image_classifiers import ARCHITECTURES, MOBILENET_WEIGHTS, build_image_model


def run_epoch(model, batches, loss_fn, device, class_indices, optimizer=None):
    training = optimizer is not None
    model.train(training)
    total_loss, expected, predicted = 0.0, [], []

    with torch.set_grad_enabled(training):
        for images, labels in batches:
            if training:
                optimizer.zero_grad(set_to_none=True)

            logits = model(images.to(device))
            loss = loss_fn(logits, labels.to(device))

            if training:
                loss.backward()
                optimizer.step()

            total_loss += loss.item() * labels.size(0)
            expected.extend(labels.tolist())
            predicted.extend(logits.detach().argmax(dim=1).cpu().tolist())

    return {
        "loss": total_loss / len(expected),
        "accuracy": accuracy_score(expected, predicted),
        "macro_f1": f1_score(
            expected, predicted, labels=class_indices, average="macro", zero_division=0
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=ARCHITECTURES, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--device", choices=("cpu", "mps", "cuda"), default="cpu")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if args.epochs < 1 or args.batch_size < 1:
        parser.error("--epochs and --batch-size must be positive")
    if args.output.exists():
        parser.error(f"Output directory already exists: {args.output}")
    if args.device == "mps" and not torch.backends.mps.is_available():
        parser.error("MPS is unavailable. Use --device cpu.")
    if args.device == "cuda" and not torch.cuda.is_available():
        parser.error("CUDA is unavailable. Use --device cpu.")

    torch.manual_seed(args.seed)
    samples, class_to_idx = load_image_splits(args.manifest, args.images)
    class_indices = list(class_to_idx.values())

    batches = {}
    for split in ("train", "val"):
        training = split == "train"
        dataset = GestureImageDataset(samples[split], build_image_transform(training=training))
        batches[split] = DataLoader(
            dataset,
            batch_size=args.batch_size,
            shuffle=training,
            generator=torch.Generator().manual_seed(args.seed),
        )

    pretrained = args.model == "mobilenet_v3_small"
    learning_rate = 3e-4 if pretrained else 1e-3
    model = build_image_model(
        args.model, len(class_indices), pretrained=pretrained
    ).to(args.device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    loss_fn = nn.CrossEntropyLoss()

    config = {
        "architecture": args.model,
        "pretrained_weights": MOBILENET_WEIGHTS.name if pretrained else None,
        "optimizer": "AdamW",
        "learning_rate": learning_rate,
        "weight_decay": 1e-4,
        "loss": "CrossEntropyLoss",
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "seed": args.seed,
        "device": args.device,
        "torch_version": str(torch.__version__),
        "manifest_sha256": hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
        "split_sizes": {split: len(rows) for split, rows in samples.items()},
    }

    history = []
    best_score = (-1.0, -1.0)
    for epoch in range(1, args.epochs + 1):
        train = run_epoch(model, batches["train"], loss_fn, args.device, class_indices, optimizer)
        val = run_epoch(model, batches["val"], loss_fn, args.device, class_indices)
        history.append({"epoch": epoch, "train": train, "val": val})
        print(
            f"Epoch {epoch:02d}/{args.epochs}  train loss={train['loss']:.4f}  "
            f"val loss={val['loss']:.4f}  val macro F1={val['macro_f1']:.4f}",
            flush=True,
        )

        score = (val["macro_f1"], val["accuracy"])
        if score > best_score:
            best_score = score
            best = {
                "epoch": epoch,
                "validation": val,
                "state_dict": {
                    name: tensor.detach().cpu().clone()
                    for name, tensor in model.state_dict().items()
                },
            }

    args.output.mkdir(parents=True)
    checkpoint = args.output / "checkpoint.pt"
    torch.save({**best, "config": config, "class_to_idx": class_to_idx}, checkpoint)
    report = {
        "config": config,
        "class_to_idx": class_to_idx,
        "best_epoch": best["epoch"],
        "epochs": history,
    }
    (args.output / "history.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Saved epoch {best['epoch']} to {checkpoint}")


if __name__ == "__main__":
    main()
