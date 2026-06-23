"""FastAPI calculation service — phase 3 (pandapower DC screening)."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from api.dc_solver import EXAMPLE_REQUEST, HAS_PANDAPOWER, run_dc_power_flow
from api.models import CalibrationStatus, DcRunRequest, DcRunResponse

app = FastAPI(
    title="Grid MVP API",
    description="Screening power flow service (pandapower). Not an operational EMS.",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "pandapower": HAS_PANDAPOWER,
        "disclaimer": "SYNTHETIC screening · NOT operational",
    }


@app.get("/dc-run/example", response_model=DcRunRequest)
def dc_run_example():
    return DcRunRequest.model_validate(EXAMPLE_REQUEST)


@app.post("/dc-run", response_model=DcRunResponse)
def dc_run(body: DcRunRequest):
    if not HAS_PANDAPOWER:
        raise HTTPException(
            status_code=503,
            detail="pandapower not installed. Run: pip install -r api/requirements.txt",
        )
    if len(body.buses) > 20:
        raise HTTPException(status_code=400, detail="max 20 buses in screening MVP")
    try:
        return run_dc_power_flow(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/calibration/status", response_model=CalibrationStatus)
def calibration_status():
    """Stub for agent calibration loop (phase 3 — design only)."""
    return CalibrationStatus(
        status="design_stub",
        description=(
            "Planned loop: batch War-Gaming → compare simulated vs observed outages → "
            "update edge capacity / repair priors. Not connected to live SCADA."
        ),
        loop=[
            "1. Run 10⁶ scenarios (batch worker + TimescaleDB)",
            "2. Metric: |P(sim outage) − P(observed)| on validation set",
            "3. Adjust synthetic parameters (grey-box + ML corrector)",
            "4. Human expert approves before deploy",
        ],
        demo_metrics={
            "sim_observed_mae_percent": 12.4,
            "calibration_round": 0,
            "scenarios_in_db": 0,
        },
    )
