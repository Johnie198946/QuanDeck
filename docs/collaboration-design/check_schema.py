"""Validate the design DDL in isolation. This does not test the QuanDeck runtime."""
from pathlib import Path
import sqlite3


def main():
    db = sqlite3.connect(":memory:")
    db.executescript(Path(__file__).with_name("schema.sql").read_text())
    checked = []
    now = "2026-11-16T08:00:00Z"

    def forbidden(label, sql, args=()):
        db.execute("SAVEPOINT negative_case")
        try:
            db.execute(sql, args)
            # Deferred FKs are checked explicitly before the surrounding transaction commits.
            violations = db.execute("PRAGMA foreign_key_check").fetchall()
            if not violations:
                raise AssertionError(f"not rejected: {label}")
        except sqlite3.IntegrityError:
            pass
        finally:
            db.execute("ROLLBACK TO negative_case")
            db.execute("RELEASE negative_case")
        checked.append(label)

    db.execute("INSERT INTO actors VALUES ('user-1','human','Owner',NULL)")
    db.execute("INSERT INTO actors VALUES ('agent-1','agent','Executor',NULL)")
    for project in ("p1", "p2"):
        db.execute("INSERT INTO projects(project_id,name,created_by,created_at) VALUES (?,?,?,?)",
                   (project, project, "user-1", now))
        db.execute("INSERT INTO project_revisions VALUES (?,1,'{}','user-1',?,'create')", (project, now))
        db.execute("INSERT INTO project_members VALUES (?,'user-1','owner')", (project,))
    for project, task in (("p1", "t1"), ("p1", "t2"), ("p2", "t3")):
        db.execute("""INSERT INTO tasks(project_id,task_id,title,kind,status,created_by,created_at,updated_at)
                      VALUES (?,?,?,'ai','ready','user-1',?,?)""", (project, task, task, now, now))
        db.execute("INSERT INTO task_revisions VALUES (?,?,1,'{}','user-1',?,'create')", (project, task, now))
    db.commit()
    checked.append("deferred project and task creation commits")

    db.execute("INSERT INTO sessions VALUES ('p1','s-pending','t1','connection-1',NULL,'execution','dispatch',?)", (now,))
    checked.append("internal session may precede real provider acknowledgment")
    forbidden("observed session requires real source identity", "INSERT INTO sessions VALUES ('p1','s-observed','t1','connection-1',NULL,'observed','observed',?)", (now,))

    forbidden("cannot silently rewrite user specification", "UPDATE task_revisions SET specification_json='{}'")
    forbidden("cannot silently delete project revision", "DELETE FROM project_revisions WHERE project_id='p1'")
    forbidden("cross-project dependency rejected", "INSERT INTO task_dependencies VALUES ('p1','t1','t3','{}',?)", (now,))
    forbidden("self dependency rejected", "INSERT INTO task_dependencies VALUES ('p1','t1','t1','{}',?)", (now,))
    forbidden("done without completion evidence rejected", "UPDATE tasks SET status='done',completed_at=? WHERE task_id='t1'", (now,))
    forbidden("AI advisory cannot approve", """INSERT INTO reviews VALUES
        ('p1','review-1','t1',1,NULL,NULL,'agent-1','ai_advisory','accepted',NULL,'{}',?)""", (now,))

    db.execute("""INSERT INTO runs(project_id,run_id,task_id,spec_revision,claim_epoch,executor_actor_id,
        purpose,dispatch_id,status,created_at) VALUES ('p1','r1','t1',1,1,'agent-1','execution','dispatch-1','running',?)""", (now,))
    db.execute("UPDATE tasks SET active_run_id='r1',claim_epoch=1,status='running',version=version+1 WHERE project_id='p1' AND task_id='t1'")
    db.commit()
    forbidden("active run must belong to same task", "UPDATE tasks SET active_run_id='r1' WHERE project_id='p1' AND task_id='t2'")
    forbidden("one run per claim generation", """INSERT INTO runs(project_id,run_id,task_id,spec_revision,claim_epoch,
        executor_actor_id,purpose,dispatch_id,status,created_at)
        VALUES ('p1','r2','t1',1,1,'agent-1','execution','dispatch-2','running',?)""", (now,))
    before = db.execute("SELECT version,spec_revision,claim_epoch FROM tasks WHERE project_id='p1' AND task_id='t1'").fetchone()
    db.execute("UPDATE runs SET last_heartbeat_at=?,lease_expires_at=? WHERE project_id='p1' AND run_id='r1'", (now, now))
    after = db.execute("SELECT version,spec_revision,claim_epoch FROM tasks WHERE project_id='p1' AND task_id='t1'").fetchone()
    assert before == after
    checked.append("heartbeat does not mutate task business versions")

    db.execute("INSERT INTO artifacts VALUES ('p1','a1','t1',1,NULL,'unknown',NULL,?)", (now,))
    db.execute("INSERT INTO artifact_versions VALUES ('p1','a1',1,'r1','agent-1','Title','Body',NULL,?,'{}',?)", ("a"*64, now))
    db.commit()
    forbidden("accepted content cannot be rewritten", "UPDATE artifact_versions SET body_text='replacement'")
    forbidden("artifact pointer cannot cross project", "INSERT INTO artifacts VALUES ('p2','a2','t1',1,NULL,'unknown',NULL,?)", (now,))
    db.execute("INSERT INTO command_receipts VALUES ('p1','user-1','claim','key-1',?,'{}',?)", ("b"*64, now))
    forbidden("duplicate command key rejected", "INSERT INTO command_receipts VALUES ('p1','user-1','claim','key-1',?,'{}',?)", ("c"*64, now))
    db.execute("INSERT INTO events VALUES ('p1','ev1',1,'task','t1','run_started','user-1','cmd1',1,'{}',?)", (now,))
    forbidden("domain event cannot be overwritten", "UPDATE events SET event_type='task_completed'")
    db.execute("INSERT INTO outbox(project_id,outbox_id,event_id,effect_type,dedupe_key,payload_json,available_at) VALUES ('p1','o1','ev1','dispatch','dispatch-1','{}',?)", (now,))
    forbidden("duplicate dispatch outbox rejected", "INSERT INTO outbox(project_id,outbox_id,event_id,effect_type,dedupe_key,payload_json,available_at) VALUES ('p1','o2','ev1','dispatch','dispatch-1','{}',?)", (now,))
    db.execute("INSERT INTO proposals VALUES ('p1','proposal-1','t1','r1','agent-1','next_step',2,'{}','pending',NULL,?)", (now,))
    forbidden("proposal content cannot be rewritten on adoption", "UPDATE proposals SET payload_json='{\"changed\":true}' WHERE proposal_id='proposal-1'")
    db.execute("INSERT INTO submissions VALUES ('p1','submission-1','t2',NULL,1,NULL,'user-1','{}','valid',?)", (now,))
    checked.append("human submission requires no AI run or session")
    forbidden("submission cannot be overwritten", "UPDATE submissions SET result_json='{\"changed\":true}'")
    db.execute("""INSERT INTO external_actions(project_id,action_id,task_id,run_id,claim_epoch,requested_by_actor_id,
        provider,operation,idempotency_key,request_json,request_sha256,status,created_at,updated_at)
        VALUES ('p1','action-human','t2',NULL,NULL,'user-1','tool','operation','action-key','{}',?,'proposed',?,?)""", ("d"*64, now, now))
    checked.append("human managed action requires no fabricated AI run")
    forbidden("settled budget cannot claim unknown usage as settled", """INSERT INTO budget_reservations VALUES
        ('p1','reserve-1','r1',1,'tokens',NULL,100,NULL,'settled',?,NULL)""", (now,))
    db.commit()
    assert not db.execute("PRAGMA foreign_key_check").fetchall()
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    checked.append("foreign key and database integrity checks")
    print(f"PASS: {len(checked)} design-schema checks")
    for name in checked:
        print(f"- {name}")
    print("Scope: DDL only; service authorization, CAS, DAG validation, delivery and runtime remain unimplemented.")


if __name__ == "__main__":
    main()
