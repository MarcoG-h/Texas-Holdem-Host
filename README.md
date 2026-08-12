# ♠ Texas Holdem Host

A single-file Texas Hold'em poker host with dual AI engines — **MATH** (mathematical decision engine) and **LLM** (large language model) — packageable as a Windows EXE.

## ✨ Features

- **Full game flow**: pre-flop / flop / turn / river, blind rotation, side pots, bust-out elimination
- **Per-player control**: each seat can be Manual / 📐 MATH / 🤖 AI
- **Review system**: table timeline of every street's actions; click 💭 to interrogate an AI about its reasoning
- **Table cloths**: green / cream / tea / black-gray, retro poker-room styling
- **Log export**: per-hand CSV auto-saved, including raw AI responses and MATH decision coefficients
- **EXE packaging**: `npm run build` via pkg

## 🤖 AI Mode (API Setup)

AI mode calls a large language model (DeepSeek or any OpenAI-compatible endpoint) to decide. It includes hand confirmation, cross-hand memory, and post-hand interrogation.

**Configure the API** — click the ⚙ gear in the left sidebar and fill in:

| Field | Description | Example |
|-------|-------------|---------|
| **Base URL** | API endpoint | `https://api.deepseek.com/v1` |
| **API Key** | Your secret key | `sk-...` |
| **Model** | Model name | `deepseek-chat` |

`deepseek-chat` is recommended ✅ (most reliable — returns the `ACTION:` format directly). Other OpenAI-compatible models work too.

## 📐 MATH Engine

MATH is a strictly mathematical decision engine with **no hand-tuned constants**. Every decision parameter is derived on the fly from the hand-equity distribution and current pot odds.

### How it decides

1. **Hand equity** — compute the win probability of the current hand:
   - **Pre-flop**: look up a precomputed Monte Carlo equity table — 169 starting hand types (13 pairs, 78 suited, 78 offsuit) × 1–8 opponents, each simulated thousands of times.
   - **Post-flop**: run **Monte Carlo simulation** on the fly. From the remaining deck, deal opponents cards sampled directly from their inferred ranges, run out the board, and tally how often the current hand wins/ties (~200–500 iterations).

2. **Expected value (EV)** — evaluate every legal action and pick the one with the highest EV:
   ```
   EV(fold)  = 0                       (sunk cost is ignored — only incremental decisions)
   EV(check) = 0
   EV(call)  = equity × (pot + call) − (1 − equity) × call
   EV(raise) = P(all fold) × pot + P(called) × (equity_vs_caller × final pot − additional bet)
   ```

3. **Opponent modeling** — instead of assuming fixed behaviors, infer each opponent's hand range from **pot odds**:
   - The required win rate to call a bet = `bet / (pot + bet)`
   - This maps (via the equity distribution) to a range width — a raise demands a stronger hand than a call.
   - Fold probability uses the GTO **minimum defense frequency** so bluff expectations aren't inflated.

4. **Risk control** — a soft penalty keeps the strategy sustainable for long-run wins rather than single-hand gambling:
   - Each raise candidate's EV is reduced by `max(0, additional bet − stack × (0.08 + equity edge))` — over-risking is taxed, not forbidden.
   - Weak hands may only raise (bluff) when fold equity is extremely high: `P(all fold) ≥ 2 × (bet / (pot + bet))`.

### Verification

100-hand self-play (4 MATH seats): all-in frequency dropped from 36% to **3.2%** after risk control; **zero deep-stack shoves**; hand equities match reference values (72o ≈ 0.24, AA ≈ 0.85 vs top-40% range).

### Implementations

All three run the same logic:
- `math_engine.js` — Node module (used by the EXE's `/api/math` endpoint)
- `math_bot.py` — standalone Python engine (reads game state JSON from stdin)
- `index.html` — in-browser fallback when opened directly as a file

## 🚀 Quick Start

```bash
# Browser (no install)
Just open index.html — configure an API Key first for AI mode.

# Local server
npm start            # serves localhost:8720
npm run build        # build the Windows EXE

# Regenerate the pre-flop equity table (~12 min)
npm run gen-equity
```

**Project layout**

```
index.html              Main app (UI + game engine + MATH/AI)
math_engine.js          MATH strict engine (Node module)
math_bot.py             MATH engine (Python)
server.js               Node local server
gen_preflop_equity.js   Pre-flop equity table generator
preflop_equity.js       Precomputed equity table (Node)
preflop_equity_browser.js  Precomputed equity table (browser)
train_math.js           Self-play health tests
train_vs_ai.js          MATH vs 3 AI training/stats
```

## License

MIT
