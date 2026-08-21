---
name: glimmer-forecast-lab
description: 'Use when changing Glimmer multi-horizon stock forecasts, vector scoring, daily prediction logs, forward validation, performance reports, forecast JSON schema, or anti-look-ahead safeguards.'
argument-hint: 'Describe the forecast model, tracking, report, or validation change'
---

# Glimmer Forecast Lab

Maintain the repository's auditable multi-horizon forward-observation pipeline.

## Invariants

1. Treat every prediction in `runs[].predictions[]` as append-only evidence. Never rewrite its stock, entry price, vector, reasons, risks, date, rank, or model version after creation.
2. Create at most one run per actual market `tradeDate` and model version. Weekend or repeated workflow executions must not create duplicates.
3. Create new predictions only when index and stock sources are live rather than cached. A stale run can update a clearly marked report but must not add samples.
4. Use trading sessions, not calendar-day arithmetic. Current horizons are 5, 10, 20, 60, 120, and 250 subsequent valid closes.
5. Keep exactly five unique stocks inside each horizon. Cross-horizon overlap is allowed because weights express different holding-period hypotheses.
6. Persist the raw factor snapshot and scored vector available at prediction time. Never reconstruct historical factors from the latest stock snapshot.
7. Preserve missing, suspended, ST, or delisted predictions in the audit trail. Mark a missing price rather than deleting the sample or counting it as zero.
8. Split model changes with a new `modelVersion`; never tune old logged outcomes retroactively.
9. Describe output as probability observation or candidates, never as guaranteed gains or executable investment instructions.
10. Daily reflection may inform later selections only through predictions already marked `matured`; never learn from active floating returns.
11. Apply a matured outcome to calibration starting on the next trading date, never to a run generated on its own exit date.
12. Require at least 20 matured samples per horizon before calibration and cap each dimension adjustment at 3% to limit small-sample overfitting.
13. Preserve each run's effective weights, experience sample count, selection analysis, and news evidence snapshot so calendar views remain historically reproducible.
14. Historical replay runs must use a distinct model version, declare point-in-time universe and factor limitations, set `trainingEligible: false`, and remain excluded from production win rates and experience calibration.
15. Treat Agent Swarm output as an immutable, deterministic supervision sidecar. It may explain, challenge, or flag a formal candidate, but must never alter the formal Vector score, rank, selected stocks, effective weights, or tracking outcome.
16. Persist the Swarm input cutoff date and hash. Never backfill a past run with evidence that was not available on that run's trade date; pre-Swarm logs must remain visibly unreviewed.

## Workflow

1. Read `scripts/update-pages-data.mjs`, `scripts/validate-forecast-data.mjs`, `site/app.js`, and the current `site/data/forecasts.json` schema.
2. Define factor availability at the prediction timestamp and reject any future-derived feature.
3. Update the generator and renderer while retaining backward-compatible fallbacks where practical.
4. Run `node --check` for changed JavaScript files.
5. Generate a snapshot with `node scripts/update-pages-data.mjs` when live sources are available.
6. Run `node scripts/validate-forecast-data.mjs`. Do not deploy if it fails.
7. Check the page at desktop and mobile widths, all six horizon tabs, report metrics, missing-price behavior, and disclaimer language.
8. Record methodology and data limitations in the UI or README whenever the model changes.
9. Verify calendar navigation selects the matching immutable run and same-day report rather than recomputing history from current data.
10. When a format preview is needed, run `scripts/backfill-forecast-preview.mjs`, validate the output, and visibly distinguish replay dates from formal forward dates.
11. For Swarm changes, verify all seven roles have structured scores, confidence, signals, warnings, and evidence, and assert `formalScoreRef === prediction.score` with `nonInterference: true`.

## Performance Reporting

- Report sample count with win rate, mean return, and median return.
- Keep active floating performance separate from matured realized observation results.
- Group results by horizon and model version when versions diverge.
- Define a win as a strictly positive close-to-close return at the configured subsequent trading session.
- Label the prediction-day close as an observation basis, not an assumed executable fill.
- Separate market review, headline-level news context, model diagnosis, and next-day experience. News must remain auxiliary evidence unless a direct stock name or code match is recorded.