# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Abay26/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Abay26/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token protocols by the implied value of the token they may one day issue, from a sealed DefiLlama snapshot. Its radar-5 model fits a comps curve on the snapshot's live-token protocols — log market cap on log TVL with one offset per comps group, plus log chain count and log age, both earned in five-fold validation — and fits it by median regression, not least squares, because the live-token set has extreme outliers: the median fit cuts the median held-out error to 1.11 log points and the mean to 1.55, against 1.59 for a flat multiple. It validates the curve out of sample in five folds, bands each protocol by its own comps group's residual spread, and adjusts each protocol's predicted market cap by seven-day growth (capped at ±60% for the multiplier), a three-phase age curve (seasoning, launch window, long tail) and chain reach. No hand-kept list of names: the same functions score every row. Every row carries a nine-step farm plan with costs, times, the record's two biggest risks and an exit step, a signal-strength score for how much of the record exists, and a netted verdict — farm, thin or skip — from what one farmer can expect against what the farm costs. The dashboard shows the farm plan first in every protocol's detail view, adds a comps chart that draws the curve itself, a net bar for the verdict, and a model sandbox that re-ranks the board live from the same function.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=qw56w9dq&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
