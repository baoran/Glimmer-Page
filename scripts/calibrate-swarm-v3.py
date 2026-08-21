#!/usr/bin/env python3
"""Build an auditable historical calibration candidate for Shadow Swarm v3.

The script never rewrites forecast logs. It uses BaoStock's date-specific stock
universe and daily fields, splits observations by time, and writes a research
artifact plus a Markdown report. Results remain shadow-only and are not a
production promotion decision.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import baostock as bs
import numpy as np
from scipy.optimize import minimize
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "swarm-calibration-v3"
ARTIFACT = ROOT / "docs" / "agents" / "data" / "swarm-v3-calibration.json"
REPORT = ROOT / "docs" / "agents" / "historical-calibration-v3.md"

CALIBRATION_VERSION = "forecast-supervision-swarm-historical-v3-candidate"
DATA_SOURCE = "BaoStock 0.9.3"
START_DATE = "2018-01-01"
LAST_ANCHOR_DATE = "2024-07-01"
DATA_END_DATE = "2025-12-31"
TRAIN_END = "2021-12-31"
VALIDATION_END = "2022-12-31"
SAMPLE_PER_ANCHOR = 320
CANDIDATES_PER_HORIZON = 20
NEWS_WEIGHT = 0.03
PRIOR = np.array([0.25, 0.25, 0.15, 0.30], dtype=float) / 0.95 * (1 - NEWS_WEIGHT)
AGENT_IDS = ("technical", "fundamental", "market", "risk")
HORIZONS = {
    "week": (5, {"momentum": .25, "participation": .25, "liquidity": .16, "valuation": .08, "stability": .12, "context": .14}),
    "two-weeks": (10, {"momentum": .22, "participation": .22, "liquidity": .16, "valuation": .12, "stability": .14, "context": .14}),
    "month": (20, {"momentum": .18, "participation": .18, "liquidity": .17, "valuation": .18, "stability": .16, "context": .13}),
    "quarter": (60, {"momentum": .13, "participation": .13, "liquidity": .19, "valuation": .24, "stability": .20, "context": .11}),
    "half-year": (120, {"momentum": .10, "participation": .10, "liquidity": .20, "valuation": .27, "stability": .23, "context": .10}),
    "year": (250, {"momentum": .08, "participation": .08, "liquidity": .22, "valuation": .30, "stability": .24, "context": .08}),
}
INDEX_CODES = ("sh.000001", "sz.399001", "sz.399006")
FIELDS = "date,code,open,high,low,close,preclose,volume,amount,turn,pctChg,peTTM,pbMRQ,tradeStatus,isST"


def clamp(value: float, lower: float = 0, upper: float = 100) -> float:
    return min(upper, max(lower, value))


def peak(value: float, ideal: float, radius: float) -> float:
    return clamp(100 - abs(value - ideal) / max(radius, .001) * 100)


def rise(value: float, lower: float, upper: float) -> float:
    return clamp((value - lower) / max(upper - lower, .001) * 100)


def safe_float(value: str | float | None, default: float = 0) -> float:
    try:
        number = float(value)  # type: ignore[arg-type]
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def stable_rank(code: str) -> str:
    return hashlib.sha256(f"glimmer-v3-point-in-time-sample:{code}".encode()).hexdigest()


def read_cache(name: str) -> Any | None:
    path = CACHE / name
    if not path.exists():
        return None
    return json.loads(path.read_text())


def write_cache(name: str, value: Any) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / name).write_text(json.dumps(value, ensure_ascii=False))


def collect(result: Any) -> list[dict[str, str]]:
    if result.error_code != "0":
        raise RuntimeError(f"BaoStock {result.error_code}: {result.error_msg}")
    rows: list[dict[str, str]] = []
    while result.next():
        rows.append(dict(zip(result.fields, result.get_row_data())))
    return rows


def query_history(code: str, start: str, end: str, fields: str = FIELDS) -> list[dict[str, str]]:
    key = f"history-{code.replace('.', '_')}-{start}-{end}.json"
    cached = read_cache(key)
    if cached is not None:
        return cached
    rows = collect(bs.query_history_k_data_plus(code, fields, start_date=start, end_date=end, frequency="d", adjustflag="3"))
    write_cache(key, rows)
    return rows


def quarter_anchors(index_rows: list[dict[str, str]]) -> list[str]:
    anchors: dict[tuple[int, int], str] = {}
    for row in index_rows:
        date = row["date"]
        if date < START_DATE or date > LAST_ANCHOR_DATE:
            continue
        dt = datetime.strptime(date, "%Y-%m-%d")
        quarter = (dt.month - 1) // 3
        anchors.setdefault((dt.year, quarter), date)
    return list(anchors.values())


def point_in_time_universe(date: str) -> list[dict[str, str]]:
    key = f"universe-{date}.json"
    cached = read_cache(key)
    if cached is not None:
        return cached
    rows = collect(bs.query_all_stock(day=date))
    stocks = [
        row for row in rows
        if row["tradeStatus"] == "1"
        and (row["code"].startswith("sh.6") or row["code"].startswith("sz.0") or row["code"].startswith("sz.3"))
        and not row["code_name"].upper().startswith(("ST", "*ST", "N", "C"))
        and "退" not in row["code_name"]
    ]
    stocks.sort(key=lambda row: stable_rank(row["code"]))
    sampled = stocks[:SAMPLE_PER_ANCHOR]
    write_cache(key, sampled)
    return sampled


def normalize_rows(rows: Iterable[dict[str, str]]) -> list[dict[str, Any]]:
    normalized = []
    for row in rows:
        if row.get("tradeStatus", "1") != "1":
            continue
        normalized.append({
            "date": row["date"], "code": row["code"],
            "open": safe_float(row.get("open")), "high": safe_float(row.get("high")),
            "low": safe_float(row.get("low")), "close": safe_float(row.get("close")),
            "preclose": safe_float(row.get("preclose")), "volume": safe_float(row.get("volume")),
            "amount": safe_float(row.get("amount")), "turn": safe_float(row.get("turn")),
            "change": safe_float(row.get("pctChg")), "pe": safe_float(row.get("peTTM")),
            "pb": safe_float(row.get("pbMRQ")), "is_st": row.get("isST") == "1",
        })
    return normalized


def market_context(index_maps: dict[str, dict[str, dict[str, Any]]], date: str) -> float:
    changes = [index_maps[code][date]["change"] for code in INDEX_CODES if date in index_maps[code]]
    if not changes:
        return 50
    breadth = sum(value > 0 for value in changes) / len(changes)
    return clamp(50 + np.mean(changes) * 8 + (breadth - .5) * 24, 20, 82)


def build_snapshot(rows: list[dict[str, Any]], index: int, context: float) -> dict[str, Any] | None:
    if index < 5:
        return None
    row = rows[index]
    if row["close"] <= 0 or row["preclose"] <= 0 or row["high"] < row["low"]:
        return None
    prior = rows[index - 5:index]
    prior_volume = np.mean([item["volume"] for item in prior])
    volume_ratio = row["volume"] / max(1, prior_volume)
    amplitude = (row["high"] - row["low"]) / row["preclose"] * 100
    close_position = (row["close"] - row["low"]) / (row["high"] - row["low"]) if row["high"] > row["low"] else .5
    float_shares = row["volume"] / (row["turn"] / 100) if row["turn"] > 0 else 0
    market_cap = float_shares * row["close"]
    log_turnover = math.log10(max(1, row["amount"]))
    log_market_cap = math.log10(max(1, market_cap))
    momentum = peak(row["change"], 3.2, 6.2) * .72 + clamp(close_position * 100) * .28
    participation = peak(volume_ratio, 1.8, 4.2) * .55 + peak(row["turn"], 5.5, 17) * .45
    liquidity = peak(log_turnover, 9.65, 2.2) * .62 + peak(log_market_cap, 11.15, 2.6) * .38
    valuation = peak(row["pe"], 22, 98) if row["pe"] > 0 else 0
    stability = peak(amplitude, 2.5, 10) * .66 + rise(log_market_cap, 9.4, 12.8) * .34
    overheat = max(0, row["change"] - 6) * 4 + max(0, volume_ratio - 3.5) * 3
    vector = {
        "momentum": clamp(momentum), "participation": clamp(participation),
        "liquidity": clamp(liquidity), "valuation": clamp(valuation),
        "stability": clamp(stability), "context": clamp(context - overheat),
    }
    eligible = (
        row["close"] >= 3 and -2 < row["change"] < 9.6 and .3 < row["turn"] < 22
        and .6 <= volume_ratio < 6 and 0 < row["pe"] < 120
        and market_cap > 3e9 and row["amount"] > 8e7 and not row["is_st"]
    )
    return {"row": row, "vector": vector, "amplitude": amplitude, "volume_ratio": volume_ratio, "market_cap": market_cap, "eligible": eligible}


def risk_score(snapshot: dict[str, Any]) -> float:
    row = snapshot["row"]
    safety = 80.0
    if snapshot["amplitude"] > 4:
        safety -= min(25, (snapshot["amplitude"] - 4) * 4)
    if row["change"] > 5:
        safety -= min(15, (row["change"] - 5) * 4)
    if snapshot["volume_ratio"] > 3:
        safety -= min(10, (snapshot["volume_ratio"] - 3) * 4)
    if row["pe"] > 50:
        safety -= min(12, (row["pe"] - 50) * .25)
    if snapshot["market_cap"] < 1e10:
        safety -= 10
    if row["amount"] < 3e8:
        safety -= min(8, (1 - row["amount"] / 3e8) * 8)
    return clamp(safety)


def adjusted_agents(snapshot: dict[str, Any], sessions: int) -> np.ndarray:
    vector = snapshot["vector"]
    technical = vector["momentum"] * .45 + vector["participation"] * .20 + vector["stability"] * .35
    fundamental = vector["valuation"] * .85 + vector["liquidity"] * .15
    market = vector["context"]
    risk = risk_score(snapshot)
    confidences = np.array([
        .62 if sessions <= 10 else .52 if sessions <= 20 else .38,
        .48 if sessions >= 60 else .32,
        .55,
        .78,
    ])
    return 50 + confidences * (np.array([technical, fundamental, market, risk]) - 50)


def forward_return(stock_map: dict[str, dict[str, Any]], calendar: list[str], date: str, sessions: int) -> float | None:
    position = calendar.index(date)
    if position + sessions >= len(calendar):
        return None
    target = calendar[position + sessions]
    if target not in stock_map:
        return None
    changes = [row["change"] for day, row in stock_map.items() if date < day <= target]
    if not changes or any(abs(value) > 25 for value in changes):
        return None
    compounded = math.prod(1 + value / 100 for value in changes) - 1
    return compounded * 100


@dataclass
class Observation:
    date: str
    code: str
    horizon: str
    sessions: int
    formal_score: float
    agents: list[float]
    return_pct: float
    outcome: int


def build_observations() -> tuple[list[Observation], dict[str, Any]]:
    index_history = {code: normalize_rows(query_history(code, "2017-10-01", DATA_END_DATE)) for code in INDEX_CODES}
    index_maps = {code: {row["date"]: row for row in rows} for code, rows in index_history.items()}
    calendar = [row["date"] for row in index_history["sh.000001"]]
    anchors = quarter_anchors(index_history["sh.000001"])
    universes = {date: point_in_time_universe(date) for date in anchors}
    names = {row["code"]: row["code_name"] for rows in universes.values() for row in rows}
    codes = sorted(names)
    print(f"时点化季度锚点 {len(anchors)} 个，确定性随机样本并集 {len(codes)} 只股票。", flush=True)
    histories: dict[str, list[dict[str, Any]]] = {}
    for number, code in enumerate(codes, 1):
        histories[code] = normalize_rows(query_history(code, "2017-10-01", DATA_END_DATE))
        if number % 50 == 0 or number == len(codes):
            print(f"历史行情 {number}/{len(codes)}", flush=True)
    observations: list[Observation] = []
    candidate_counts: dict[str, dict[str, int]] = {}
    for date in anchors:
        context = market_context(index_maps, date)
        sampled_codes = {row["code"] for row in universes[date]}
        snapshots = []
        for code in sampled_codes:
            rows = histories.get(code, [])
            row_index = next((i for i, row in enumerate(rows) if row["date"] == date), -1)
            if row_index < 0:
                continue
            snapshot = build_snapshot(rows, row_index, context)
            if snapshot and snapshot["eligible"]:
                snapshots.append((code, snapshot, {row["date"]: row for row in rows}))
        candidate_counts[date] = {"sampled": len(sampled_codes), "eligible": len(snapshots)}
        for horizon, (sessions, formal_weights) in HORIZONS.items():
            ranked = []
            for code, snapshot, stock_map in snapshots:
                score = sum(snapshot["vector"][factor] * weight for factor, weight in formal_weights.items())
                penalty = max(0, 1 - snapshot["row"]["change"]) * 2.5 if sessions <= 10 else max(0, snapshot["row"]["change"] - 7) * .9
                future = forward_return(stock_map, calendar, date, sessions)
                if future is not None:
                    ranked.append((clamp(score - penalty, 0, 99), code, snapshot, future))
            for score, code, snapshot, future in sorted(ranked, reverse=True)[:CANDIDATES_PER_HORIZON]:
                observations.append(Observation(date, code, horizon, sessions, score, adjusted_agents(snapshot, sessions).tolist(), future, int(future > 0)))
    metadata = {"anchors": anchors, "uniqueStocks": len(codes), "candidateCounts": candidate_counts}
    return observations, metadata


def sigmoid(value: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-np.clip(value, -30, 30)))


def model_probability(x: np.ndarray, weights: np.ndarray, center: float, temperature: float) -> np.ndarray:
    bounded_x = np.clip(np.nan_to_num(x, nan=50, posinf=100, neginf=0), 0, 100)
    bounded_weights = np.clip(np.nan_to_num(weights, nan=0, posinf=1, neginf=0), 0, 1)
    bounded_center = clamp(float(center), 0, 100)
    bounded_temperature = clamp(float(temperature), 1, 100)
    consensus = np.sum(bounded_x * bounded_weights, axis=1) + 50 * NEWS_WEIGHT
    return sigmoid((consensus - bounded_center) / bounded_temperature)


def fit_candidate(train_x: np.ndarray, train_y: np.ndarray, validation_x: np.ndarray, validation_y: np.ndarray) -> dict[str, Any]:
    lower = np.maximum(.03, PRIOR - .10)
    upper = np.minimum(.50, PRIOR + .10)
    choices = []
    for regularization in (1, 5, 20, 80):
        def objective(parameters: np.ndarray) -> float:
            weights, center, temperature = parameters[:4], parameters[4], parameters[5]
            probabilities = model_probability(train_x, weights, center, temperature)
            return log_loss(train_y, probabilities) + regularization * float(np.sum((weights - PRIOR) ** 2))

        initial = np.r_[PRIOR, 58.0, 10.0]
        constraints = ({"type": "eq", "fun": lambda parameters: np.sum(parameters[:4]) - (1 - NEWS_WEIGHT)},)
        bounds = [*zip(lower, upper), (42, 75), (4, 20)]
        result = minimize(objective, initial, method="SLSQP", bounds=bounds, constraints=constraints, options={"maxiter": 1000, "ftol": 1e-10})
        if not result.success:
            raise RuntimeError(f"优化失败：{result.message}")
        probabilities = model_probability(validation_x, result.x[:4], result.x[4], result.x[5])
        choices.append({"regularization": regularization, "parameters": result.x, "validationBrier": brier_score_loss(validation_y, probabilities)})
    return min(choices, key=lambda item: item["validationBrier"])


def metrics(y: np.ndarray, probabilities: np.ndarray) -> dict[str, float]:
    base = np.full(len(y), np.mean(y))
    return {
        "samples": int(len(y)), "positiveRate": round(float(np.mean(y)), 4),
        "auc": round(float(roc_auc_score(y, probabilities)), 4),
        "brier": round(float(brier_score_loss(y, probabilities)), 4),
        "logLoss": round(float(log_loss(y, probabilities)), 4),
        "constantBrier": round(float(brier_score_loss(y, base)), 4),
    }


def bootstrap_test(x: np.ndarray, y: np.ndarray, dates: np.ndarray, parameters: np.ndarray) -> dict[str, list[float]]:
    rng = np.random.default_rng(20260821)
    unique_dates = np.unique(dates)
    aucs, briers = [], []
    for _ in range(1000):
        sampled_dates = rng.choice(unique_dates, size=len(unique_dates), replace=True)
        indices = np.concatenate([np.flatnonzero(dates == date) for date in sampled_dates])
        sampled_y = y[indices]
        if len(np.unique(sampled_y)) < 2:
            continue
        probabilities = model_probability(x[indices], parameters[:4], parameters[4], parameters[5])
        aucs.append(roc_auc_score(sampled_y, probabilities))
        briers.append(brier_score_loss(sampled_y, probabilities))
    return {
        "auc95": [round(float(value), 4) for value in np.quantile(aucs, [.025, .975])],
        "brier95": [round(float(value), 4) for value in np.quantile(briers, [.025, .975])],
    }


def evaluate(observations: list[Observation], metadata: dict[str, Any]) -> dict[str, Any]:
    x = np.array([item.agents for item in observations])
    y = np.array([item.outcome for item in observations])
    dates = np.array([item.date for item in observations])
    train = dates <= TRAIN_END
    validation = (dates > TRAIN_END) & (dates <= VALIDATION_END)
    test = dates > VALIDATION_END
    choice = fit_candidate(x[train], y[train], x[validation], y[validation])
    parameters = choice["parameters"]
    prior_probabilities = model_probability(x[test], PRIOR, parameters[4], parameters[5])
    candidate_probabilities = model_probability(x[test], parameters[:4], parameters[4], parameters[5])
    by_horizon = {}
    for horizon in HORIZONS:
        mask = test & np.array([item.horizon == horizon for item in observations])
        if np.sum(mask) and len(np.unique(y[mask])) > 1:
            by_horizon[horizon] = metrics(y[mask], model_probability(x[mask], parameters[:4], parameters[4], parameters[5]))
    test_candidate = metrics(y[test], candidate_probabilities)
    test_prior = metrics(y[test], prior_probabilities)
    improvement = test_prior["brier"] - test_candidate["brier"]
    bootstrap = bootstrap_test(x[test], y[test], dates[test], parameters)
    recommended = bool(improvement > 0 and test_candidate["auc"] >= .52 and bootstrap["auc95"][0] >= .48)
    calibrated_weights = {agent: round(float(weight), 4) for agent, weight in zip(AGENT_IDS, parameters[:4])}
    calibrated_weights["news"] = NEWS_WEIGHT
    input_hash = hashlib.sha256(json.dumps([asdict(item) for item in observations], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    artifact = {
        "version": CALIBRATION_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "historical-candidate",
        "evidenceLevel": "E1-R",
        "calibrationStage": "E2-rejected",
        "validated": False,
        "shadowOnly": True,
        "trainingEligible": False,
        "recommendedForForwardShadow": recommended,
        "data": {
            "source": DATA_SOURCE, "priceAdjustment": "raw; outcomes compounded from daily pctChg",
            "start": START_DATE, "lastAnchor": LAST_ANCHOR_DATE, "outcomeDataEnd": DATA_END_DATE,
            "universe": f"每个季度首个交易日的实际上市交易股票；按代码稳定哈希抽取 {SAMPLE_PER_ANCHOR} 只",
            "candidateSelection": f"按 horizon-vector-v2 历史可见代理排序后每周期取前 {CANDIDATES_PER_HORIZON} 只",
            "news": "历史新闻覆盖不足；固定中性，权重仅保留 3% 文献先验",
            "splits": {"train": f"{START_DATE}..{TRAIN_END}", "validation": f"2022-01-01..{VALIDATION_END}", "test": f"2023-01-01..{LAST_ANCHOR_DATE}"},
            "sampleCount": len(observations), "anchorCount": len(metadata["anchors"]), "uniqueStockCount": metadata["uniqueStocks"],
            "observationInputHash": input_hash,
        },
        "parameters": {
            "agentWeights": calibrated_weights,
            "priorWeights": {**{agent: round(float(weight), 4) for agent, weight in zip(AGENT_IDS, PRIOR)}, "news": NEWS_WEIGHT},
            "probabilityCalibration": {"center": round(float(parameters[4]), 4), "temperature": round(float(parameters[5]), 4)},
            "regularization": choice["regularization"],
            "bounds": "各可训练 Agent 相对研究先验最多移动 10 个百分点；权重非负且总和为 1",
        },
        "evaluation": {
            "train": metrics(y[train], model_probability(x[train], parameters[:4], parameters[4], parameters[5])),
            "validation": metrics(y[validation], model_probability(x[validation], parameters[:4], parameters[4], parameters[5])),
            "testCandidate": test_candidate, "testResearchPrior": test_prior,
            "testBrierImprovement": round(float(improvement), 4), "clusterBootstrap": bootstrap,
            "testByHorizon": by_horizon,
        },
        "limitations": [
            "BaoStock 不是交易所官方 point-in-time 数据库，字段修订历史和退市覆盖仍需二次核验。",
            "股票样本为确定性随机子样本，不是完整 A 股横截面；总市值由成交量和换手率推导为流通市值代理。",
            "历史新闻不足，因此新闻参数没有被训练；财报公告时点、行业中性和交易成本尚未进入模型。",
            "候选与周期共享股票和日期；测试置信区间采用日期簇 bootstrap，但不能完全消除相关性。",
            "E2-rejected 表示本次历史校准尝试未通过冻结测试；不得接入前向运行、覆盖 v2 或改写历史日志。",
        ],
    }
    return artifact


def markdown(artifact: dict[str, Any]) -> str:
    p = artifact["parameters"]
    e = artifact["evaluation"]
    rows = "\n".join(f"| {agent} | {p['priorWeights'][agent]:.2%} | {p['agentWeights'][agent]:.2%} |" for agent in (*AGENT_IDS, "news"))
    horizon_rows = "\n".join(f"| {horizon} | {values['samples']} | {values['positiveRate']:.2%} | {values['auc']:.3f} | {values['brier']:.3f} |" for horizon, values in e["testByHorizon"].items())
    decision = "建议进入新的前向 shadow 候选" if artifact["recommendedForForwardShadow"] else "历史冻结测试未达到启用门槛，不建议接入前向 shadow"
    return f"""# Historical Calibration v3 Candidate

## 结论

- 状态：`E1-R / E2-rejected`，`validated: false`，`shadowOnly: true`，`trainingEligible: false`。
- 决策：**{decision}**。
- 本报告不会修改 v1、v2、正式 Vector 或任何历史预测。

## 数据与防泄漏

- 数据源：{artifact['data']['source']}。
- 训练：{artifact['data']['splits']['train']}；验证：{artifact['data']['splits']['validation']}；冻结测试：{artifact['data']['splits']['test']}。
- 共 {artifact['data']['anchorCount']} 个季度时点、{artifact['data']['uniqueStockCount']} 只历史样本股票、{artifact['data']['sampleCount']} 条候选-周期观测。
- 规范化观测输入 SHA-256：`{artifact['data']['observationInputHash']}`。
- 每个季度只使用该日实际上市交易股票，再以固定哈希抽样；特征只使用当日及此前数据，结果使用后续第 N 个市场交易日。
- 新闻历史不足，固定为中性且只保留 3% 研究先验；没有拿当前新闻或当前股票池回填历史。

## 候选参数

| Agent | 历史优化基准 | v3 历史候选 |
|---|---:|---:|
{rows}

概率映射仅用于历史评估：

$$
p=\\sigma\\left(\\frac{{C-{p['probabilityCalibration']['center']:.4f}}}{{{p['probabilityCalibration']['temperature']:.4f}}}\\right)
$$

这不是经过长期前向校准的真实上涨概率，页面若接入也必须标记为历史估计。

## 冻结测试结果

| 模型 | 样本 | 正收益率 | AUC | Brier | Log loss |
|---|---:|---:|---:|---:|---:|
| 历史优化基准 | {e['testResearchPrior']['samples']} | {e['testResearchPrior']['positiveRate']:.2%} | {e['testResearchPrior']['auc']:.3f} | {e['testResearchPrior']['brier']:.3f} | {e['testResearchPrior']['logLoss']:.3f} |
| v3 历史候选 | {e['testCandidate']['samples']} | {e['testCandidate']['positiveRate']:.2%} | {e['testCandidate']['auc']:.3f} | {e['testCandidate']['brier']:.3f} | {e['testCandidate']['logLoss']:.3f} |

- Brier 改善：{e['testBrierImprovement']:+.4f}（正数表示候选更好）。
- 日期簇 bootstrap AUC 95% 区间：{e['clusterBootstrap']['auc95']}。
- 日期簇 bootstrap Brier 95% 区间：{e['clusterBootstrap']['brier95']}。

### 分周期测试

| 周期 | 样本 | 正收益率 | AUC | Brier |
|---|---:|---:|---:|---:|
{horizon_rows}

## 限制

""" + "\n".join(f"- {item}" for item in artifact["limitations"]) + "\n"


def main() -> None:
    login = bs.login()
    if login.error_code != "0":
        raise RuntimeError(f"BaoStock 登录失败：{login.error_msg}")
    try:
        observations, metadata = build_observations()
    finally:
        bs.logout()
    artifact = evaluate(observations, metadata)
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    ARTIFACT.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n")
    REPORT.write_text(markdown(artifact))
    decision = "通过历史候选门槛" if artifact["recommendedForForwardShadow"] else "未通过历史候选门槛"
    print(f"v3 校准完成：{artifact['data']['sampleCount']} 条观测，{decision}。")
    print(f"参数：{json.dumps(artifact['parameters']['agentWeights'], ensure_ascii=False)}")
    print(f"冻结测试：{json.dumps(artifact['evaluation']['testCandidate'], ensure_ascii=False)}")


if __name__ == "__main__":
    main()
