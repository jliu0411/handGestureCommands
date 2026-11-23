from typing import Literal

from pydantic import BaseModel, Field


class Prediction(BaseModel):
    gesture: Literal["palm", "fist", "like", "dislike", "peace", "point", "unknown", "no_hand"]
    confidence: float | None = Field(ge=0, le=1)
    action: Literal["pause", "stop", "confirm", "cancel", "next", "select"] | None
    hand_detected: bool
    model_name: Literal["random_forest"]
