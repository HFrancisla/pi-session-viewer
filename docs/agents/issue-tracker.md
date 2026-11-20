# 事项跟踪：GitHub Issues（Issue Tracker）

本仓库用 GitHub Issues 跟踪实际需求、缺陷和规格说明，使用 `gh` CLI 操作。仓库地址以当前 `git remote -v` 为准，避免硬编码另一个工作区。

## 事项操作（Issue Operations）

- 创建：`gh issue create --title "..." --body "..."`；多行内容通过 heredoc 传入。
- 阅读：`gh issue view <number> --json number,title,body,labels,comments`。
- 列出：`gh issue list --state open --json number,title,body,labels,comments`，按需增加 `--label`。
- 评论：`gh issue comment <number> --body "..."`。
- 修改标签：`gh issue edit <number> --add-label "..."` 或 `--remove-label "..."`。
- 关闭：`gh issue close <number> --comment "..."`。

所有状态标签采用 `docs/agents/triage-labels.md` 定义的现行约定。要发布规格说明时创建 Issue；要读取待办事项时使用 `gh issue view`。操作已有 Issue 前先读当前内容，不覆盖尚未确认的用户变更。

## Pull Request 范围

**PRs as a request surface: no.** 当前事项入口是 GitHub Issues，PR 不直接作为需求分诊入口。需要核对单个编号代表的资源类型时，先通过 `gh pr view <number>` 检查，必要时使用 `gh issue view <number>`。

## 父子事项与阻塞关系（Sub-issues and Dependencies）

确有多步骤计划时可使用 GitHub 的父子 Issue 结构：`gh issue create --parent <parent> ...`，或用 `gh issue edit <parent> --add-sub-issue <child>` 关联现有事项。分阶段计划可用标签 `wayfinder:map`，子事项可用 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling`、`wayfinder:task`。

阻塞关系使用 GitHub 原生 Issue Dependencies：先通过 `gh api repos/<owner>/<repo>/issues/<number> --jq .id` 取得数据库 ID，再用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 记录。只有依赖解除后的事项才属于可执行前沿。对未确认的阻塞依赖，不得擅自解除。
