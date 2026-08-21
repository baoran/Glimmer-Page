# Agent Swarm 子系统索引

本目录是七个子 Agent 的独立设计说明。实现采用“公共契约 + 六个专业 Agent + 仲裁 Agent + 编排器”，入口保持为 `scripts/lib/forecast-swarm.mjs`。

> **参数来源声明：**当前公式、权重、阈值和置信度属于 E1 人工工程先验，不来自论文、行业标准或历史拟合，也未达到样本外验证等级。逐项来源、当前分布问题和科学升级流程见 [参数来源与证据等级](parameter-provenance.md)。

## 实现地图

| Agent | 实现 | 文档 | 当前作用 |
|---|---|---|---|
| 数据 Agent | `scripts/lib/forecast-swarm/agents/data-agent.mjs` | [data-agent.md](data-agent.md) | 检查字段完整性和来源状态 |
| 技术 Agent | `scripts/lib/forecast-swarm/agents/technical-agent.mjs` | [technical-agent.md](technical-agent.md) | 复核动能、参与和稳定性 |
| 基本面 Agent | `scripts/lib/forecast-swarm/agents/fundamental-agent.mjs` | [fundamental-agent.md](fundamental-agent.md) | 估值及规模约束 |
| 市场 Agent | `scripts/lib/forecast-swarm/agents/market-agent.mjs` | [market-agent.md](market-agent.md) | 市场广度和情境复核 |
| 新闻 Agent | `scripts/lib/forecast-swarm/agents/news-agent.mjs` | [news-agent.md](news-agent.md) | 标题级直接证据核验 |
| 风险 Agent | `scripts/lib/forecast-swarm/agents/risk-agent.mjs` | [risk-agent.md](risk-agent.md) | 主动寻找反证并计算安全余量 |
| 仲裁 Agent | `scripts/lib/forecast-swarm/agents/arbitration-agent.mjs` | [arbitration-agent.md](arbitration-agent.md) | 汇总共识与分歧，不干预正式排名 |

参数治理文档：[参数来源与证据等级](parameter-provenance.md)。

研究优化版本：[Research-grounded Shadow Swarm v2](research-grounded-v2.md)。该版本参考同行评议论文和 A 股研究调整参数，但仍为未经本站样本外验证的 E1-R shadow，不替换 v1。

历史校准实验：[Historical Calibration v3 Candidate](historical-calibration-v3.md)。该实验使用时点化股票池以及训练、验证、冻结测试三段数据；当前结果未通过接入门槛，因此没有覆盖或替换 v2。

其他模块：

- `shared.mjs`：版本、角色定义、权重、统一输出构造和评分工具。
- `orchestrator.mjs`：调用七个 Agent，生成输入哈希、候选级监督快照、日级汇总和日报。
- `forecast-swarm.mjs`：稳定公共入口；调用方只依赖它，内部模块可以分别演进。

## 统一输入边界

所有输入必须在 `dataCutoffTradeDate` 当日收盘时可见。禁止读取未来价格、未来新闻、到期结果或后续修订数据。启用日前的历史日志不补写 Swarm 结论。

专业 Agent 按需读取以下输入子集：

- `stock`：候选股票当日行情截面。
- `vector`：正式模型生成并保存的六维 Vector。
- `market`：当日核心指数快照和交易日。
- `news`：当日已聚合的标题级资讯。
- `sourceStatus`：`live`、`partial` 或 `stale`。
- `amplitude`：预测日内振幅。
- `formalScore`：正式 Vector 分数，只作为引用和对照。

## 统一专业 Agent 输出

六个专业 Agent 均输出：

- `agentId`、`label`、`version`
- `verdict`：`support`、`neutral` 或 `challenge`
- `score`：0–100
- `confidence`：0–1，表示证据充分程度，不是上涨概率
- `signals[]`：主要支持或中性观察
- `warnings[]`：风险、数据缺口和反证
- `evidence[]`：生成结论时使用的可审计文本证据

仲裁 Agent 额外输出 `actionTag`、`disagreement` 和 `nonInterference: true`。

## 版本与变更规则

1. 只修改解释文字且不改变结果，可保持 Agent 版本。
2. 修改公式、阈值、输入字段或结论语义，必须升级对应 Agent 版本；如果 JSON 契约变化，还要升级 Swarm schema。
3. 不得重算并覆盖历史 Swarm 快照。
4. 新版本必须与旧版本分组评估，不能把不同口径的结果直接合并。
5. Swarm 永远不能改写正式候选、`score`、`rank`、有效权重或追踪结果。

## 优化前检查清单

- 新输入是否在预测时真实可见？
- 是否会与其他 Agent 重复计算并放大同一因子？
- 缺失数据是否降低 `confidence`，而不是悄悄填充乐观值？
- 是否有固定输入的确定性测试？
- 是否使用足够的已到期样本做样本外验证？
- 是否检查支持率、挑战率和高分歧率，避免所有结果长期同质化？
- 是否保留 `formalScoreRef === prediction.score` 和 `nonInterference: true`？
