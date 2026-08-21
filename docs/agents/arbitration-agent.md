# 仲裁 Agent

## 定位与作用

仲裁 Agent 汇总六个专业 Agent 的结构化输出，给出监督共识、专业分歧和研究动作标签。它是只读协调器，不是正式选股模型，也没有权限修改候选、分数、排名或权重。

## 实现位置

- `scripts/lib/forecast-swarm/agents/arbitration-agent.mjs`
- 入口函数：`runArbitrationAgent({ agents, formalScore })`

## 输入

- `agents.data`
- `agents.technical`
- `agents.fundamental`
- `agents.market`
- `agents.news`
- `agents.risk`
- `formalScore`：只用于并列记录和非干预核验。

## 输出

- `score`：监督共识分。
- `confidence`：六个专业 Agent 置信度的加权平均。
- `verdict`：支持、中性或质疑。
- `actionTag`：`research-support`、`observe`、`manual-review` 或 `risk-review`。
- `disagreement`：最高与最低专业分的差值及等级。
- `nonInterference: true`。

## 当前实现方法

$$
C=0.15D+0.25T+0.15F+0.15M+0.10N+0.20R
$$

其中 $R$ 是安全余量。仲裁规则：

- 数据或风险 Agent 为质疑时，最终直接质疑。
- 否则 $C<48$ 为质疑，$C\ge65$ 为支持，中间为中性。
- 专业分最大差值至少 35 为高分歧，至少 20 为中分歧，否则为低分歧。
- 质疑标记 `risk-review`；高分歧标记 `manual-review`；支持标记 `research-support`；其余标记 `observe`。

## 当前风险与局限

1. 权重和阈值是初始工程规则，尚未经过充分样本外验证。
2. 多个 Agent 使用相关输入，简单加权可能重复放大同一信息。
3. 中性新闻固定 50 会拉低高分候选并制造高分歧。
4. 当前支持率或高分歧率可能过于集中，必须持续监控分布。
5. 共识分不是上涨概率，不能按百分比解释。
6. 硬质疑只覆盖数据和风险，其他严重反证目前不会硬否决。

## 可深入优化方向

- 按六个持有周期分别校准权重，但必须使用足够的已到期样本。
- 采用相关性约束、stacking 或贝叶斯方式估计增量证据。
- 对 Agent 置信度做可靠性校准，并区分“无证据”和“负证据”。
- 监控支持率、挑战率、分歧率、Brier score 和收益/风险分层表现。
- 建立 shadow arbitration 版本并行观察，优于现版本后再升级。

## 不可突破的约束

- 必须保持 `formalScoreRef === prediction.score`。
- 必须输出 `nonInterference: true`，不得调用正式排序函数。
- 不能用 active 浮动结果调权；只允许从下一交易日起使用 matured 样本。
- 公式或阈值发生实质变化时必须升级版本，历史仲裁结果不得重写。
