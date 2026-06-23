"""DC / AC power flow via pandapower (screening)."""

from __future__ import annotations

from api.models import DcRunRequest, DcRunResponse, LineResult

try:
    import pandapower as pp
    import pandapower.run as pp_run

    HAS_PANDAPOWER = True
except ImportError:
    HAS_PANDAPOWER = False


def _default_rx(vn_kv: float) -> tuple[float, float]:
    if vn_kv >= 300:
        return 0.03, 0.3
    return 0.08, 0.35


def run_dc_power_flow(req: DcRunRequest) -> DcRunResponse:
    if not HAS_PANDAPOWER:
        raise RuntimeError("pandapower not installed — pip install -r api/requirements.txt")

    bus_ids = sorted({b.id for b in req.buses})
    if len(bus_ids) != len(req.buses):
        raise ValueError("duplicate bus ids")
    if req.slack_bus not in bus_ids:
        raise ValueError("slack_bus not in buses")

    net = pp.create_empty_network()
    idx_map = {}
    for b in sorted(req.buses, key=lambda x: x.id):
        idx_map[b.id] = pp.create_bus(net, vn_kv=b.vn_kv, name=b.name or f"bus_{b.id}")

    pp.create_ext_grid(net, bus=idx_map[req.slack_bus], vm_pu=1.0, name="slack")

    for g in req.generators:
        if g.bus not in idx_map:
            raise ValueError(f"generator bus {g.bus} unknown")
        pp.create_gen(net, bus=idx_map[g.bus], p_mw=g.p_mw, vm_pu=g.vm_pu, name=f"gen_{g.bus}")

    for ld in req.loads:
        if ld.bus not in idx_map:
            raise ValueError(f"load bus {ld.bus} unknown")
        pp.create_load(net, bus=idx_map[ld.bus], p_mw=ld.p_mw, q_mvar=ld.q_mvar, name=f"load_{ld.bus}")

    for i, line in enumerate(req.lines):
        if line.from_bus not in idx_map or line.to_bus not in idx_map:
            raise ValueError(f"line {i} references unknown bus")
        vn = next(b.vn_kv for b in req.buses if b.id == line.from_bus)
        r_km, x_km = line.r_ohm_per_km, line.x_ohm_per_km
        if r_km is None or x_km is None:
            r_km, x_km = _default_rx(vn)
        pp.create_line_from_parameters(
            net,
            from_bus=idx_map[line.from_bus],
            to_bus=idx_map[line.to_bus],
            length_km=line.length_km,
            r_ohm_per_km=r_km,
            x_ohm_per_km=x_km,
            c_nf_per_km=0.0,
            max_i_ka=line.max_i_ka,
            name=f"line_{line.from_bus}_{line.to_bus}",
        )

    try:
        if req.run_ac:
            engine = "pandapower AC (Newton-Raphson)"
            pp_run.runpp(net, algorithm="nr", init="flat")
        else:
            engine = "pandapower DC"
            pp.rundcpp(net)
    except Exception:
        return DcRunResponse(
            engine=engine if req.run_ac else "pandapower DC",
            converged=False,
            slack_bus=req.slack_bus,
            bus_vm_pu={},
            line_results=[],
        )

    bus_vm: dict[int, float] = {}
    rev = {v: k for k, v in idx_map.items()}
    for pp_idx in range(len(net.bus)):
        logical = rev.get(pp_idx)
        if logical is not None:
            bus_vm[logical] = round(float(net.res_bus.at[pp_idx, "vm_pu"]), 4)

    line_results: list[LineResult] = []
    for li in range(len(net.line)):
        from_id = rev[net.line.at[li, "from_bus"]]
        to_id = rev[net.line.at[li, "to_bus"]]
        p = float(net.res_line.at[li, "p_from_mw"])
        i_ka = float(net.res_line.at[li, "i_from_ka"])
        max_i = float(net.line.at[li, "max_i_ka"])
        loading = round((abs(i_ka) / max_i * 100) if max_i > 0 else 0.0, 2)
        line_results.append(
            LineResult(
                from_bus=from_id,
                to_bus=to_id,
                p_from_mw=round(p, 3),
                loading_percent=loading,
                max_i_ka=max_i,
            )
        )

    return DcRunResponse(
        engine=engine,
        converged=True,
        slack_bus=req.slack_bus,
        bus_vm_pu=bus_vm,
        line_results=line_results,
    )


EXAMPLE_REQUEST = {
    "buses": [
        {"id": 0, "vn_kv": 330, "name": "ПС 330 slack"},
        {"id": 1, "vn_kv": 330, "name": "ПС 330 gen"},
        {"id": 2, "vn_kv": 110, "name": "ПС 110 load"},
    ],
    "generators": [{"bus": 1, "p_mw": 120}],
    "loads": [{"bus": 2, "p_mw": 95, "q_mvar": 20}],
    "lines": [
        {"from_bus": 0, "to_bus": 1, "length_km": 12, "max_i_ka": 0.8},
        {"from_bus": 1, "to_bus": 2, "length_km": 25, "max_i_ka": 0.4},
    ],
    "slack_bus": 0,
    "run_ac": False,
}
