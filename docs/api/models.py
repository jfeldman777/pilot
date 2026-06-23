from typing import Optional

from pydantic import BaseModel, Field


class BusIn(BaseModel):
    id: int
    vn_kv: float = 330.0
    name: str = ""


class GeneratorIn(BaseModel):
    bus: int
    p_mw: float
    vm_pu: float = 1.0


class LoadIn(BaseModel):
    bus: int
    p_mw: float
    q_mvar: float = 0.0


class LineIn(BaseModel):
    from_bus: int
    to_bus: int
    length_km: float = 10.0
    max_i_ka: float = 0.5
    r_ohm_per_km: Optional[float] = None
    x_ohm_per_km: Optional[float] = None


class DcRunRequest(BaseModel):
    buses: list[BusIn] = Field(..., min_length=2, max_length=20)
    generators: list[GeneratorIn] = Field(default_factory=list)
    loads: list[LoadIn] = Field(default_factory=list)
    lines: list[LineIn] = Field(default_factory=list)
    slack_bus: int = 0
    run_ac: bool = False


class LineResult(BaseModel):
    from_bus: int
    to_bus: int
    p_from_mw: float
    loading_percent: float
    max_i_ka: float


class DcRunResponse(BaseModel):
    engine: str
    converged: bool
    slack_bus: int
    bus_vm_pu: dict[int, float]
    line_results: list[LineResult]
    disclaimer: str = "pandapower screening run · SYNTHETIC parameters · NOT operational"


class CalibrationStatus(BaseModel):
    status: str
    description: str
    loop: list[str]
    demo_metrics: dict[str, float]
