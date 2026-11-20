# 事项状态标签（Triage Labels）

本项目使用以下五种事项处理状态。左列是工具使用的规范角色（Canonical Triage Role），右列是在 GitHub Issues 中使用的标签名（GitHub Label）。名称保持一致，避免工具与事项状态出现不同的叫法。

| 处理角色（Role） | GitHub 标签（Label） | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 等待维护者分类和评估 |
| `needs-info` | `needs-info` | 缺少决策或复现所需信息 |
| `ready-for-agent` | `ready-for-agent` | 已明确需求及验收标准，可以交由编码 Agent 实现 |
| `ready-for-human` | `ready-for-human` | 需要人工处理或决策 |
| `wontfix` | `wontfix` | 已决定不处理 |

使用 `gh issue edit <number> --add-label "<label>"` 更新对应状态。以上是本仓库配置的标签约定；对外部 GitHub 实际标签是否存在，应以查询结果为准。
