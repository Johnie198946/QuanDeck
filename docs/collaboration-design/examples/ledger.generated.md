export_content_sha256: a96e3887f9bfa4e70e55a0932aceb9b0098d73c5f6db29c24aa7a6850642db5c

# 泰国旅行示例台帐

这是设计夹具。文件是只读导出；手工改字不会改变任务状态。

project_id: proj_thailand_demo
schema_version: 1
source_seq: 48
generated_at: 2026-11-16T05:00:00Z
generated: true

| 显示编号 | 任务 | 当前状态 | 负责人 | 当前执行 | 采用成果 | 当前适用性 |
| --- | --- | --- | --- | --- | --- | --- |
| A5 | 交通研究 | done | 示例用户 | 已结束 | artifact_A5 v2 | 具体日期待核验 |
| C10 | 住宿研究 | done | 示例用户 | 已结束 | artifact_C10 v2 | 城市与日期待明确 |
| E21 | 游玩研究 | done | 示例用户 | 已结束 | artifact_E21 v2 | 开放信息待核验 |
| G82 | 美食研究 | done | 示例用户 | 已结束 | artifact_G82 v2 | 营业信息待核验 |
| T83 | 整合旅行意向 | in_review | 示例用户 | run_T83_R1 已提交 | 尚无；候选 artifact_T83 v1 | 待验收 |

T83引用：A5@v2、C10@v2、E21@v2、G82@v2。引用不表示复制旧聊天全文。
T83提交：submission_T83_R1，要求版本spec_revision=3。
T83本次运行：run_T83_R1，内部会话session_T83_R1；源端身份以真实adapter回执为准。
下一步建议：“确认日期”仍为proposal，没有擅自创建已排程或执行中的任务。
更新入口：ReviewSubmission、ReviseTask、ConfirmDecision等业务命令。
追溯入口：ReadTaskHistory、ReadArtifactVersion、ReadSourceVersion。
