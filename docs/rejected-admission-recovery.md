# 派发受理前失败的恢复

本地执行记录不等于 Agent 已经受理。预检明确拒绝时，应保留诊断容器和失败记录，源会话 ID 与受理时间保持为空。

- 自动计划根据已保存会话的受理阶段判断结果。明确拒绝且已确认停止记为失败；真正无法确定是否已受理仍保留未知状态并阻止重复派发。
- 一个叶任务被明确拒绝，不阻止无依赖的其他分支继续。失败叶任务不会被系统自动重试。
- 历史记录若因误判停在「未知」，只有同一项目、任务、派发 ID 和已核验连接的拒绝及停止证据才允许修复。原始源记录和台帐历史不删除、不伪造完成。
- 任务详情对已确认可重试的失败显示「重新派发此任务」。双击复用同一个正在进行的重试；新执行获得新派发/源会话身份，并替换自动计划中的当前尝试关联。
- 「查看派发问题」打开该任务已经绑定的本地诊断窗口。没有源会话时不再拿本地记录 ID 冒充源会话跳转。
- 已经受理的失败执行必须有明确停止证据才能重试。未知受理、停止未确认或已有接手执行保持防重复执行边界。

验证：runtime-data 测试包含无源会话的拒绝、诊断身份恢复、停止门槛和双击幂等；goal-delivery 测试包含被拒绝叶子与独立分支、旧未知记录修复、显式重试的新身份及真正未知状态的隔离。

## Current state after an acknowledged retry

A retry now records its predecessor. Only after the new source acknowledges admission is the previous execution retained as history; its original failed status and evidence are unchanged. Overview, task progress and activity counters no longer treat that stopped historical failure as a current problem.

Older retries without this link are resolved by a read-only projection of the ledger: the same project/task/subtask and purpose must have a newer claim epoch, a matching ledger run/session binding and an acknowledged source session. Unconfirmed stops, unknown admission, pending tool requests and unrelated task scopes remain visible. This also works after the newer run finishes; no timestamp guessing or fabricated completion is used.
