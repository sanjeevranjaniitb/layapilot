import truststore
truststore.inject_into_ssl()

from laya import load
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any
import uvicorn

app = FastAPI(title="LayaPilot")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

print("Loading Laya...")
agent = load("convaiinnovations/laya")
print("Laya loaded.")

QUESTIONS = {
    "steering": {
        "type": "choice",
        "instructions": "Based on the road ahead, lane offset, and heading error, what steering correction should the autonomous vehicle apply right now?",
        "criteria": {
            "hard_left":  "strong left correction — lane offset is far right or large left curve ahead",
            "left":       "gentle left correction — slight right drift or mild left curve",
            "straight":   "no correction needed — car is centered in lane, road is straight",
            "right":      "gentle right correction — slight left drift or mild right curve",
            "hard_right": "strong right correction — lane offset is far left or large right curve ahead",
        }
    },
    "speed": {
        "type": "choice",
        "instructions": "Based on current speed, speed limit, road curvature, distance to destination, and upcoming junction or road type change, what should the vehicle do with its speed?",
        "criteria": {
            "accelerate":    "increase speed — below speed limit and road is clear and straight",
            "maintain":      "hold current speed — at or near speed limit, road conditions normal",
            "slow_slightly": "reduce speed slightly — mild curve ahead, approaching junction, or road type changing",
            "brake":         "brake firmly — sharp curve, junction within 30m, well above limit, or near destination",
        }
    },
    "routing": {
        "type": "choice",
        "instructions": "Given the current road type, upcoming junction distance, and next road type, what high-level routing action should the vehicle take?",
        "criteria": {
            "follow_route":  "continue on current road following the planned route — no junction or transition imminent",
            "prepare_turn":  "slow and position for an upcoming turn at a junction within 60m",
            "take_exit":     "move to exit lane — currently on interstate and exit is within 150m",
            "merge":         "accelerate to merge speed — currently on on-ramp approaching interstate",
            "prepare_stop":  "approach destination or stop line — within 40m of final destination",
        }
    },
    "risk": {
        "type": "score",
        "instructions": "Rate the overall risk of the current driving situation considering speed, curvature, lane position, and proximity to junctions.",
        "criteria": ["completely safe", "low risk", "moderate caution", "high risk", "critical danger"]
    }
}

class DecisionRequest(BaseModel):
    state: dict[str, Any]

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/decide")
def decide(req: DecisionRequest):
    result = agent.predict(req.state, QUESTIONS)
    return result

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)
