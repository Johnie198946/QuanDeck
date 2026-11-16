-- QuanDeck collaboration target schema, version 1.
-- Design artifact ONLY: initialize an empty database; never run against workspace.json.
-- Service owns the DB connection; agents cannot execute SQL or open the DB file.
PRAGMA foreign_keys = ON;

CREATE TABLE actors (
  actor_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('human','agent','service')),
  display_name TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  spec_revision INTEGER NOT NULL DEFAULT 1 CHECK(spec_revision > 0),
  event_seq INTEGER NOT NULL DEFAULT 0 CHECK(event_seq >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','archived')),
  created_by TEXT NOT NULL REFERENCES actors(actor_id),
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id,spec_revision) REFERENCES project_revisions(project_id,revision)
    DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE project_revisions (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  -- goal, scope, budget, execution policy and acceptance policy; schema-validated by service.
  specification_json TEXT NOT NULL CHECK(json_valid(specification_json)),
  created_by TEXT NOT NULL REFERENCES actors(actor_id),
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY(project_id,revision)
);
CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  actor_id TEXT NOT NULL REFERENCES actors(actor_id),
  role TEXT NOT NULL CHECK(role IN ('owner','contributor','reviewer','reader','executor')),
  PRIMARY KEY(project_id,actor_id)
);

CREATE TABLE tasks (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  task_id TEXT NOT NULL,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('human','ai','hybrid')),
  owner_actor_id TEXT REFERENCES actors(actor_id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','ready','running','blocked','paused','in_review','done','failed','cancelled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  spec_revision INTEGER NOT NULL DEFAULT 1 CHECK(spec_revision > 0),
  claim_epoch INTEGER NOT NULL DEFAULT 0 CHECK(claim_epoch >= 0),
  active_run_id TEXT,
  blocked_reason TEXT,
  due_at TEXT,
  completion_kind TEXT CHECK(completion_kind IN ('review','legacy_import')),
  completion_review_id TEXT,
  legacy_completion_json TEXT CHECK(legacy_completion_json IS NULL OR json_valid(legacy_completion_json)),
  completed_at TEXT,
  created_by TEXT NOT NULL REFERENCES actors(actor_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id,task_id),
  CHECK(parent_task_id IS NULL OR parent_task_id <> task_id),
  CHECK(status <> 'done' OR (completed_at IS NOT NULL AND completion_kind IS NOT NULL AND
    ((completion_kind='review' AND completion_review_id IS NOT NULL) OR
     (completion_kind='legacy_import' AND legacy_completion_json IS NOT NULL)))),
  FOREIGN KEY(project_id,parent_task_id) REFERENCES tasks(project_id,task_id),
  FOREIGN KEY(project_id,task_id,spec_revision) REFERENCES task_revisions(project_id,task_id,revision)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(project_id,task_id,active_run_id) REFERENCES runs(project_id,task_id,run_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(project_id,task_id,completion_review_id) REFERENCES reviews(project_id,task_id,review_id)
    DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE task_revisions (
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  -- Required fields: goal, deliverables, acceptance_criteria, constraints, scope, stop_conditions.
  specification_json TEXT NOT NULL CHECK(json_valid(specification_json)),
  created_by TEXT NOT NULL REFERENCES actors(actor_id),
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY(project_id,task_id,revision),
  FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,task_id)
);
CREATE TABLE task_dependencies (
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  -- Required output versions belong in the task specification and context package.
  condition_json TEXT NOT NULL CHECK(json_valid(condition_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,task_id,depends_on_task_id),
  CHECK(task_id <> depends_on_task_id),
  FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,task_id),
  FOREIGN KEY(project_id,depends_on_task_id) REFERENCES tasks(project_id,task_id)
);

CREATE TABLE sessions (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  session_id TEXT NOT NULL,
  task_id TEXT,
  connection_id TEXT NOT NULL,
  source_session_id TEXT,
  purpose TEXT NOT NULL CHECK(purpose IN ('execution','discussion','review','observed')),
  origin TEXT NOT NULL CHECK(origin IN ('dispatch','observed','import')),
  created_at TEXT NOT NULL,
  CHECK(origin='dispatch' OR source_session_id IS NOT NULL),
  PRIMARY KEY(project_id,session_id),
  UNIQUE(connection_id,source_session_id),
  UNIQUE(project_id,task_id,session_id),
  FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,task_id)
);
CREATE TABLE runs (
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  spec_revision INTEGER NOT NULL,
  claim_epoch INTEGER NOT NULL CHECK(claim_epoch > 0),
  executor_actor_id TEXT NOT NULL REFERENCES actors(actor_id),
  purpose TEXT NOT NULL CHECK(purpose IN ('execution','discussion','review')),
  session_id TEXT,
  context_package_id TEXT,
  dispatch_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN
    ('queued','running','waiting_input','waiting_permission','paused','succeeded','failed','cancelled','lost')),
  lease_expires_at TEXT,
  last_heartbeat_at TEXT,
  provider_cursor TEXT,
  started_at TEXT,
  ended_at TEXT,
  end_reason TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,run_id),
  UNIQUE(project_id,task_id,run_id),
  UNIQUE(project_id,task_id,claim_epoch),
  FOREIGN KEY(project_id,task_id,spec_revision) REFERENCES task_revisions(project_id,task_id,revision),
  FOREIGN KEY(project_id,task_id,session_id) REFERENCES sessions(project_id,task_id,session_id),
  FOREIGN KEY(project_id,task_id,run_id,context_package_id)
    REFERENCES context_packages(project_id,task_id,run_id,context_package_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE blobs (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  blob_id TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  bytes INTEGER NOT NULL CHECK(bytes >= 0),
  media_type TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('staged','ready','deleted')),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY(project_id,blob_id)
);
CREATE TABLE source_records (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  source_record_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN ('user','provider','web','file','manual_import')),
  dedupe_key TEXT NOT NULL,
  actor_id TEXT REFERENCES actors(actor_id),
  session_id TEXT,
  blob_id TEXT,
  excerpt TEXT,
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(project_id,source_record_id),
  UNIQUE(project_id,origin,dedupe_key),
  FOREIGN KEY(project_id,session_id) REFERENCES sessions(project_id,session_id),
  FOREIGN KEY(project_id,blob_id) REFERENCES blobs(project_id,blob_id)
);

CREATE TABLE decisions (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  decision_id TEXT NOT NULL,
  task_id TEXT,
  category TEXT NOT NULL CHECK(category IN ('constraint','preference','choice','authorization','rejection')),
  current_revision INTEGER NOT NULL CHECK(current_revision > 0),
  PRIMARY KEY(project_id,decision_id),
  FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,task_id),
  FOREIGN KEY(project_id,decision_id,current_revision)
    REFERENCES decision_revisions(project_id,decision_id,revision) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE decision_revisions (
  project_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  authority TEXT NOT NULL CHECK(authority IN ('proposed','confirmed','rejected','withdrawn')),
  statement_json TEXT NOT NULL CHECK(json_valid(statement_json)),
  source_record_id TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES actors(actor_id),
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY(project_id,decision_id,revision),
  FOREIGN KEY(project_id,decision_id) REFERENCES decisions(project_id,decision_id),
  FOREIGN KEY(project_id,source_record_id) REFERENCES source_records(project_id,source_record_id)
);

CREATE TABLE context_packages (
  project_id TEXT NOT NULL,
  context_package_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  task_version INTEGER NOT NULL,
  spec_revision INTEGER NOT NULL,
  project_spec_revision INTEGER NOT NULL,
  policy_version TEXT NOT NULL,
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
  token_estimate INTEGER CHECK(token_estimate >= 0),
  token_budget INTEGER NOT NULL CHECK(token_budget > 0),
  issued_at TEXT NOT NULL,
  PRIMARY KEY(project_id,context_package_id),
  UNIQUE(project_id,task_id,run_id,context_package_id),
  FOREIGN KEY(project_id,task_id,run_id) REFERENCES runs(project_id,task_id,run_id),
  FOREIGN KEY(project_id,task_id,spec_revision) REFERENCES task_revisions(project_id,task_id,revision),
  FOREIGN KEY(project_id,project_spec_revision) REFERENCES project_revisions(project_id,revision)
);
CREATE TABLE context_items (
  project_id TEXT NOT NULL,
  context_package_id TEXT NOT NULL,
  item_no INTEGER NOT NULL CHECK(item_no >= 0),
  kind TEXT NOT NULL CHECK(kind IN ('artifact','decision','source','task_revision','skill')),
  ref_id TEXT NOT NULL,
  ref_revision TEXT NOT NULL,
  locator TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
  reason TEXT NOT NULL,
  PRIMARY KEY(project_id,context_package_id,item_no),
  FOREIGN KEY(project_id,context_package_id) REFERENCES context_packages(project_id,context_package_id)
);
CREATE TABLE checkpoints (
  project_id TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  progress_json TEXT NOT NULL CHECK(json_valid(progress_json)),
  source_cursor TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,checkpoint_id),
  FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,run_id)
);

CREATE TABLE artifacts (
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  current_version INTEGER NOT NULL CHECK(current_version > 0),
  accepted_version INTEGER,
  freshness TEXT NOT NULL DEFAULT 'unknown' CHECK(freshness IN ('current','stale','unknown')),
  freshness_reason TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,artifact_id),
  UNIQUE(project_id,task_id,artifact_id),
  FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,task_id),
  FOREIGN KEY(project_id,artifact_id,current_version)
    REFERENCES artifact_versions(project_id,artifact_id,version) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(project_id,artifact_id,accepted_version)
    REFERENCES artifact_versions(project_id,artifact_id,version) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE artifact_versions (
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  run_id TEXT,
  created_by TEXT NOT NULL REFERENCES actors(actor_id),
  title TEXT NOT NULL,
  body_text TEXT,
  body_blob_id TEXT,
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
  -- claims, citations, applicability, verification time, unresolved issues, attachments.
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,artifact_id,version),
  CHECK(body_text IS NOT NULL OR body_blob_id IS NOT NULL),
  FOREIGN KEY(project_id,artifact_id) REFERENCES artifacts(project_id,artifact_id),
  FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,run_id),
  FOREIGN KEY(project_id,body_blob_id) REFERENCES blobs(project_id,blob_id)
);
CREATE TABLE artifact_inputs (
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_version INTEGER NOT NULL,
  input_kind TEXT NOT NULL CHECK(input_kind IN ('artifact','decision','source','task_revision','skill')),
  input_id TEXT NOT NULL,
  input_revision TEXT NOT NULL,
  locator TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
  PRIMARY KEY(project_id,artifact_id,artifact_version,input_kind,input_id,input_revision,locator),
  FOREIGN KEY(project_id,artifact_id,artifact_version)
    REFERENCES artifact_versions(project_id,artifact_id,version)
);
CREATE TABLE reviews (
  project_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  spec_revision INTEGER NOT NULL,
  run_id TEXT,
  submission_id TEXT,
  reviewer_actor_id TEXT NOT NULL REFERENCES actors(actor_id),
  mode TEXT NOT NULL CHECK(mode IN ('human','policy','ai_advisory')),
  verdict TEXT NOT NULL CHECK(verdict IN ('accepted','rejected','needs_changes','advisory')),
  policy_version TEXT,
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,review_id),
  UNIQUE(project_id,task_id,review_id),
  CHECK(mode <> 'ai_advisory' OR verdict='advisory'),
  CHECK(mode <> 'policy' OR policy_version IS NOT NULL),
  FOREIGN KEY(project_id,task_id,spec_revision) REFERENCES task_revisions(project_id,task_id,revision),
  FOREIGN KEY(project_id,task_id,run_id) REFERENCES runs(project_id,task_id,run_id)
  ,FOREIGN KEY(project_id,task_id,submission_id) REFERENCES submissions(project_id,task_id,submission_id)
);

-- AI/user proposals are persisted before any adoption or scheduling decision.
CREATE TABLE proposals (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  proposal_id TEXT NOT NULL,
  task_id TEXT,
  run_id TEXT,
  created_by TEXT NOT NULL REFERENCES actors(actor_id),
  kind TEXT NOT NULL CHECK(kind IN ('task_plan','task_change','decision','next_step')),
  base_task_version INTEGER,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','adopted','rejected','superseded')),
  resolution_event_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,proposal_id),
  CHECK(run_id IS NULL OR task_id IS NOT NULL),
  FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,task_id),
  FOREIGN KEY(project_id,task_id,run_id) REFERENCES runs(project_id,task_id,run_id),
  FOREIGN KEY(project_id,resolution_event_id) REFERENCES events(project_id,event_id)
);
CREATE TABLE submissions (
  project_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  run_id TEXT,
  spec_revision INTEGER NOT NULL,
  context_package_id TEXT,
  submitted_by TEXT NOT NULL REFERENCES actors(actor_id),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  -- This is the backend intake verdict, never the task's completion state.
  intake_status TEXT NOT NULL CHECK(intake_status IN ('valid','invalid','stale')),
  submitted_at TEXT NOT NULL,
  PRIMARY KEY(project_id,submission_id),
  UNIQUE(project_id,task_id,submission_id),
  CHECK(run_id IS NOT NULL OR context_package_id IS NULL),
  FOREIGN KEY(project_id,task_id,spec_revision) REFERENCES task_revisions(project_id,task_id,revision),
  FOREIGN KEY(project_id,task_id,run_id) REFERENCES runs(project_id,task_id,run_id),
  FOREIGN KEY(project_id,task_id,run_id,context_package_id)
    REFERENCES context_packages(project_id,task_id,run_id,context_package_id)
);
CREATE TABLE budget_reservations (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  reservation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  project_spec_revision INTEGER NOT NULL,
  resource TEXT NOT NULL CHECK(resource IN ('tokens','cost_microunits','wall_seconds')),
  currency TEXT,
  reserved_amount INTEGER NOT NULL CHECK(reserved_amount >= 0),
  settled_amount INTEGER CHECK(settled_amount >= 0),
  state TEXT NOT NULL CHECK(state IN ('reserved','settled','released','uncertain')),
  created_at TEXT NOT NULL,
  settled_at TEXT,
  PRIMARY KEY(project_id,reservation_id),
  UNIQUE(project_id,run_id,resource),
  CHECK(resource <> 'cost_microunits' OR currency IS NOT NULL),
  CHECK(state <> 'settled' OR settled_amount IS NOT NULL),
  FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,run_id),
  FOREIGN KEY(project_id,project_spec_revision) REFERENCES project_revisions(project_id,revision)
);
-- Opaque IDs only; intentionally no project FK so a deletion receipt survives a purge.
CREATE TABLE erasure_jobs (
  erasure_job_id TEXT PRIMARY KEY,
  opaque_project_id TEXT NOT NULL,
  requested_by_actor_id TEXT NOT NULL,
  scope_ids_json TEXT NOT NULL CHECK(json_valid(scope_ids_json)),
  status TEXT NOT NULL CHECK(status IN ('requested','authorized','running','completed','failed')),
  authorized_at TEXT,
  completed_at TEXT,
  proof_json TEXT CHECK(proof_json IS NULL OR json_valid(proof_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE events (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  event_id TEXT NOT NULL,
  project_seq INTEGER NOT NULL CHECK(project_seq > 0),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES actors(actor_id),
  command_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(project_id,event_id),
  UNIQUE(project_id,project_seq)
);
CREATE TABLE command_receipts (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  actor_id TEXT NOT NULL REFERENCES actors(actor_id),
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  committed_at TEXT NOT NULL,
  PRIMARY KEY(project_id,actor_id,operation,idempotency_key)
);
CREATE TABLE outbox (
  project_id TEXT NOT NULL,
  outbox_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  effect_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','delivered','dead','uncertain')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  available_at TEXT NOT NULL,
  locked_until TEXT,
  last_error TEXT,
  PRIMARY KEY(project_id,outbox_id),
  UNIQUE(project_id,effect_type,dedupe_key),
  FOREIGN KEY(project_id,event_id) REFERENCES events(project_id,event_id)
);
CREATE TABLE external_actions (
  project_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  run_id TEXT,
  claim_epoch INTEGER,
  requested_by_actor_id TEXT NOT NULL REFERENCES actors(actor_id),
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
  authorization_decision_id TEXT,
  authorization_revision INTEGER,
  status TEXT NOT NULL CHECK(status IN ('proposed','authorized','dispatched','succeeded','failed','unknown','cancelled')),
  external_reference TEXT,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id,action_id),
  UNIQUE(project_id,provider,idempotency_key),
  CHECK((run_id IS NULL) = (claim_epoch IS NULL)),
  CHECK((authorization_decision_id IS NULL) = (authorization_revision IS NULL)),
  FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,task_id),
  FOREIGN KEY(project_id,task_id,run_id) REFERENCES runs(project_id,task_id,run_id),
  FOREIGN KEY(project_id,authorization_decision_id,authorization_revision)
    REFERENCES decision_revisions(project_id,decision_id,revision)
);
CREATE TABLE usage_observations (
  project_id TEXT NOT NULL,
  usage_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  provider_metric_key TEXT NOT NULL,
  input_tokens INTEGER CHECK(input_tokens >= 0),
  output_tokens INTEGER CHECK(output_tokens >= 0),
  cached_input_tokens INTEGER CHECK(cached_input_tokens >= 0),
  cost_microunits INTEGER CHECK(cost_microunits >= 0),
  currency TEXT,
  -- cumulative snapshots are not summed; billing deltas use provider_metric_key dedupe.
  measurement TEXT NOT NULL CHECK(measurement IN ('cumulative','delta','estimate')),
  is_final INTEGER NOT NULL DEFAULT 0 CHECK(is_final IN (0,1)),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(project_id,usage_id),
  UNIQUE(project_id,run_id,provider_metric_key),
  FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,run_id),
  FOREIGN KEY(project_id,source_record_id) REFERENCES source_records(project_id,source_record_id)
);
CREATE TABLE projection_offsets (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  projection TEXT NOT NULL CHECK(projection IN ('ledger','blackboard','search')),
  applied_seq INTEGER NOT NULL DEFAULT 0 CHECK(applied_seq >= 0),
  generated_at TEXT,
  PRIMARY KEY(project_id,projection)
);

CREATE INDEX tasks_status_owner ON tasks(project_id,status,owner_actor_id);
CREATE INDEX task_dependents ON task_dependencies(project_id,depends_on_task_id);
CREATE INDEX runs_task_time ON runs(project_id,task_id,created_at);
CREATE INDEX artifact_task ON artifacts(project_id,task_id);
CREATE INDEX artifact_input_reverse ON artifact_inputs(project_id,input_kind,input_id,input_revision);
CREATE INDEX outbox_pending ON outbox(state,available_at);
CREATE INDEX events_aggregate ON events(project_id,aggregate_type,aggregate_id,project_seq);

-- Enforce append-only facts under the normal application connection.
-- Privacy erasure is a separate authenticated maintenance/export-rebuild operation,
-- never an agent command or a mutable bypass switch in this schema.
CREATE TRIGGER project_revisions_no_update BEFORE UPDATE ON project_revisions BEGIN SELECT RAISE(ABORT,'immutable project revision'); END;
CREATE TRIGGER project_revisions_no_delete BEFORE DELETE ON project_revisions BEGIN SELECT RAISE(ABORT,'immutable project revision'); END;
CREATE TRIGGER task_revisions_no_update BEFORE UPDATE ON task_revisions BEGIN SELECT RAISE(ABORT,'immutable task revision'); END;
CREATE TRIGGER task_revisions_no_delete BEFORE DELETE ON task_revisions BEGIN SELECT RAISE(ABORT,'immutable task revision'); END;
CREATE TRIGGER decisions_no_update BEFORE UPDATE ON decision_revisions BEGIN SELECT RAISE(ABORT,'immutable decision revision'); END;
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON decision_revisions BEGIN SELECT RAISE(ABORT,'immutable decision revision'); END;
CREATE TRIGGER artifacts_no_update BEFORE UPDATE ON artifact_versions BEGIN SELECT RAISE(ABORT,'immutable artifact version'); END;
CREATE TRIGGER artifacts_no_delete BEFORE DELETE ON artifact_versions BEGIN SELECT RAISE(ABORT,'immutable artifact version'); END;
CREATE TRIGGER artifact_inputs_no_update BEFORE UPDATE ON artifact_inputs BEGIN SELECT RAISE(ABORT,'immutable artifact input'); END;
CREATE TRIGGER artifact_inputs_no_delete BEFORE DELETE ON artifact_inputs BEGIN SELECT RAISE(ABORT,'immutable artifact input'); END;
CREATE TRIGGER context_no_update BEFORE UPDATE ON context_packages BEGIN SELECT RAISE(ABORT,'immutable context package'); END;
CREATE TRIGGER context_no_delete BEFORE DELETE ON context_packages BEGIN SELECT RAISE(ABORT,'immutable context package'); END;
CREATE TRIGGER context_items_no_update BEFORE UPDATE ON context_items BEGIN SELECT RAISE(ABORT,'immutable context item'); END;
CREATE TRIGGER context_items_no_delete BEFORE DELETE ON context_items BEGIN SELECT RAISE(ABORT,'immutable context item'); END;
CREATE TRIGGER checkpoints_no_update BEFORE UPDATE ON checkpoints BEGIN SELECT RAISE(ABORT,'immutable checkpoint'); END;
CREATE TRIGGER checkpoints_no_delete BEFORE DELETE ON checkpoints BEGIN SELECT RAISE(ABORT,'immutable checkpoint'); END;
CREATE TRIGGER reviews_no_update BEFORE UPDATE ON reviews BEGIN SELECT RAISE(ABORT,'immutable review'); END;
CREATE TRIGGER reviews_no_delete BEFORE DELETE ON reviews BEGIN SELECT RAISE(ABORT,'immutable review'); END;
CREATE TRIGGER proposals_content_no_update BEFORE UPDATE OF project_id,proposal_id,task_id,run_id,created_by,kind,base_task_version,payload_json,created_at ON proposals BEGIN SELECT RAISE(ABORT,'immutable proposal content'); END;
CREATE TRIGGER proposals_no_delete BEFORE DELETE ON proposals BEGIN SELECT RAISE(ABORT,'immutable proposal'); END;
CREATE TRIGGER submissions_no_update BEFORE UPDATE ON submissions BEGIN SELECT RAISE(ABORT,'immutable submission'); END;
CREATE TRIGGER submissions_no_delete BEFORE DELETE ON submissions BEGIN SELECT RAISE(ABORT,'immutable submission'); END;
CREATE TRIGGER sources_no_update BEFORE UPDATE ON source_records BEGIN SELECT RAISE(ABORT,'immutable source record'); END;
CREATE TRIGGER sources_no_delete BEFORE DELETE ON source_records BEGIN SELECT RAISE(ABORT,'immutable source record'); END;
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER receipts_no_update BEFORE UPDATE ON command_receipts BEGIN SELECT RAISE(ABORT,'immutable command receipt'); END;
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON command_receipts BEGIN SELECT RAISE(ABORT,'immutable command receipt'); END;
CREATE TRIGGER usage_no_update BEFORE UPDATE ON usage_observations BEGIN SELECT RAISE(ABORT,'immutable usage observation'); END;
CREATE TRIGGER usage_no_delete BEFORE DELETE ON usage_observations BEGIN SELECT RAISE(ABORT,'immutable usage observation'); END;
