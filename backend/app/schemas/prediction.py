from typing import Literal

from pydantic import BaseModel, Field


class HandCenter(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)

class FingerStates(BaseModel):
    thumb: bool
    index: bool
    middle: bool
    ring: bool
    pinky: bool


class Prediction(BaseModel):
    gesture: Literal["palm", "fist", "like", "dislike", "peace", "point", "unknown", "no_hand"]
    confidence: float | None = Field(ge=0, le=1)
    action: Literal["pause", "stop", "confirm", "cancel", "next", "select"] | None
    hand_detected: bool
    model_name: Literal["random_forest"]
    hand_center: HandCenter | None = None
    finger_count: int | None = Field(default=None, ge=0, le=5)
    finger_states: FingerStates | None = None
    finger_count_quality: Literal["reliable", "uncertain"] | None = None
