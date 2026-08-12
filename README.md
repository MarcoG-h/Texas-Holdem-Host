# ♠ Texas Hold'em 德州扑克

单文件德州扑克发牌器 + 双 AI 引擎（MATH 数学决策 / LLM 决策），可打包为 Windows EXE。

## ✨ 功能

- **完整对局流程**：翻前/翻牌/转牌/河牌，盲注轮换、边池（side pot）、破产出局
- **玩家托管**：每个玩家可设为手动 / 📐 MATH / 🤖 AI
  - **MATH**：蒙特卡洛胜率 + 期望收益（EV）决策引擎，可本地运行或独立 Python 版
  - **AI**：调用大模型（DeepSeek 等 OpenAI 兼容 API）决策，含手牌二次确认、跨局记忆、复盘追问
- **复盘系统**：表格时间轴展示每轮行动，可点击 💭 追问 AI 的思考过程
- **多款台布**：绿/奶白/茶/黑灰，复古扑克室风格
- **日志导出**：自动保存每局 CSV，含 AI 原始返回与 MATH 决策系数
- **打包 EXE**：`npm run build` 用 pkg 打包

## 🚀 快速开始

```bash
# 浏览器直接打开
# 双击 index.html 即可（AI 需配置 API Key）

# 或作为本地服务
npm start            # 启动 localhost:8720
npm run build        # 打包 Windows EXE

# 重新生成翻前胜率表 (~12 分钟)
npm run gen-equity
```

## ⚙️ API 配置

应用内左侧 ⚙ → 填入 Base URL / API Key / Model。

推荐 Model：
- `deepseek-chat` ✅ 最稳定（直接返回 ACTION 格式）
- OpenAI 兼容接口均可

## 📐 MATH 引擎

MATH 采用严格计算、无经验常数：
- **预计算翻前胜率表**（169 手牌 × 8 对手数，蒙特卡洛，见 `gen_preflop_equity.js`）
- **翻后蒙特卡洛** 实时算 vs 对手范围的胜率
- **纯 EV 最大化**决策（弃/跟/加各自 EV，选最大）
- 对手范围从**底池赔率**推导，弃牌概率用 GTO **最小防守频率**
- 三实现保持一致：`math_engine.js`（Node）、`math_bot.py`（Python）、浏览器内回退

> ⚠️ **已知限制**：当前 MATH 在纯 EV 模型下有全押偏高的倾向（详见 `train_vs_ai.js` 训练结果），仍在调优中。请勿将其描述为"必胜"策略。

## 🤖 AI 决策流程

1. 系统提示词要求 AI 先确认手牌（防止抓错牌）
2. 传入完整牌局上下文（手牌、公共牌、底池、筹码、对手、可用动作、底池赔率）
3. 解析 AI 返回的 `ACTION:` 行，执行决策
4. 每局结束 AI 自动总结对手打法，跨局记忆传递给下一局

## 📂 项目结构

```
index.html              主应用（界面+游戏引擎+MATH/AI）
math_engine.js          MATH 严格决策引擎（Node 模块, /api/math）
math_bot.py             MATH 的 Python 版
server.js               Node 本地服务（静态 + /api/math + 日志保存）
gen_preflop_equity.js   翻前胜率表生成器
preflop_equity.*        预计算胜率表（浏览器/Node 两版）
train_math.js           自对弈测试
train_vs_ai.js          MATH vs 3 AI 训练/统计
蒙特卡洛扑克胜率计算.md  蒙特卡洛原理文档
```

## 🔒 安全

- **API Key 仅存 localStorage**，不写入代码
- 日志保存在本地 `logs/`（含决策数据，勿公开上传）
- `.gitignore` 已排除密钥/日志/构建产物

## 📄 许可证

MIT
