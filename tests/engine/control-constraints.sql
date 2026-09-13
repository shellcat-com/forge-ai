-- Shared by embedded PostgreSQL and the disposable native PostgreSQL check.
BEGIN;
SET LOCAL search_path=forge_control,pg_catalog;
CREATE FUNCTION pg_temp.expect_error(statement text, expected_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = expected_code THEN RETURN; END IF;
  RAISE EXCEPTION 'Expected %, got %: %', expected_code, SQLSTATE, SQLERRM;
 END;
 RAISE EXCEPTION 'Statement unexpectedly succeeded: %', statement;
END $$;
CREATE FUNCTION pg_temp.assert_true(value boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END $$;
INSERT INTO users(id,oidc_issuer,oidc_subject) VALUES
 ('00000000-0000-4000-8000-000000000001','https://fixture.invalid','fixture-user');
INSERT INTO workspaces(id,name) VALUES
 ('00000000-0000-4000-8000-000000000010','fixture workspace A'),('00000000-0000-4000-8000-000000000020','fixture workspace B');
INSERT INTO memberships(workspace_id,user_id,role) VALUES('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','editor');
SELECT pg_temp.expect_error($q$INSERT INTO memberships(workspace_id,user_id,role) VALUES('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000001','admin')$q$,'23514');
INSERT INTO projects(id,workspace_id,name,brief,preset_id,preset_version,template_id,template_digest) VALUES
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000010','A','Synthetic fixture task board','fixture',1,'next-postgres-v1',repeat('a',64)),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000010','A2','Synthetic fixture task board','fixture',1,'next-postgres-v1',repeat('a',64)),
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000020','B','Synthetic fixture task board','fixture',1,'next-postgres-v1',repeat('a',64));
CREATE FUNCTION pg_temp.add_job(j uuid,w uuid,p uuid) RETURNS void LANGUAGE sql AS $$
 INSERT INTO jobs(id,workspace_id,project_id,created_by,kind,base_revision,request_json,policy_digest,template_digest,prompt_version,model_policy_json,cost_limit_micros,active_remaining_ms)
 VALUES(j,w,p,'00000000-0000-4000-8000-000000000001','generate',1,'{"schemaVersion":1}',repeat('a',64),repeat('a',64),'fixture-v1','{"schemaVersion":1}',0,1200000)
$$;
SELECT pg_temp.add_job('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011');
SELECT pg_temp.add_job('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012');
SELECT pg_temp.add_job('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000021');
SELECT pg_temp.expect_error($q$SELECT pg_temp.add_job('00000000-0000-4000-8000-000000000999','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000021')$q$,'23503');
SELECT pg_temp.expect_error($q$SELECT pg_temp.add_job('00000000-0000-4000-8000-000000000999','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011')$q$,'23505');
SELECT pg_temp.expect_error($q$UPDATE jobs SET cost_limit_micros=-1 WHERE id='00000000-0000-4000-8000-000000000101'$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE jobs SET request_json='{}' WHERE id='00000000-0000-4000-8000-000000000101'$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE jobs SET request_json=jsonb_build_object('schemaVersion',1,'x',repeat('x',65536)) WHERE id='00000000-0000-4000-8000-000000000101'$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE jobs SET policy_digest='bad' WHERE id='00000000-0000-4000-8000-000000000101'$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE jobs SET state='SUCCEEDED',state_version=2,finished_at=now() WHERE id='00000000-0000-4000-8000-000000000101'$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE jobs SET state='PLANNING' WHERE id='00000000-0000-4000-8000-000000000101'$q$,'23514');
UPDATE jobs SET state='PLANNING',state_version=2 WHERE id='00000000-0000-4000-8000-000000000101';
SELECT pg_temp.expect_error($q$UPDATE jobs SET state='AWAITING_PLAN_APPROVAL',state_version=3 WHERE id='00000000-0000-4000-8000-000000000101'$q$,'23514');
UPDATE jobs SET state='AWAITING_PLAN_APPROVAL',state_version=3,review_expires_at=now()+interval '1 hour',review_digest=repeat('a',64),review_json='{"schemaVersion":1}' WHERE id='00000000-0000-4000-8000-000000000101';
UPDATE jobs SET state='CANCELLING',state_version=4,review_expires_at=NULL,review_digest=NULL,review_json=NULL,cancel_requested_at=now() WHERE id='00000000-0000-4000-8000-000000000101';
SELECT pg_temp.expect_error($q$UPDATE jobs SET state='FAILED',state_version=5,finished_at=now() WHERE id='00000000-0000-4000-8000-000000000101'$q$,'23514');
UPDATE jobs SET state='CANCELLED',state_version=5,finished_at=now() WHERE id='00000000-0000-4000-8000-000000000101';
SELECT pg_temp.expect_error($q$UPDATE jobs SET state='QUEUED',state_version=6,finished_at=NULL WHERE id='00000000-0000-4000-8000-000000000101'$q$,'23514');
-- INSERT checks below reach the real column constraints, independent of the
-- immutable admitted-job UPDATE trigger. The previous project job is terminal.
SELECT pg_temp.expect_error($q$INSERT INTO jobs SELECT (jsonb_populate_record(NULL::jobs,to_jsonb(j) || jsonb_build_object('id','00000000-0000-4000-8000-000000000999','request_json','{}'::jsonb))).* FROM jobs j WHERE id='00000000-0000-4000-8000-000000000101'$q$,'23514');
SELECT pg_temp.expect_error($q$INSERT INTO jobs SELECT (jsonb_populate_record(NULL::jobs,to_jsonb(j) || jsonb_build_object('id','00000000-0000-4000-8000-000000000999','cost_limit_micros',-1))).* FROM jobs j WHERE id='00000000-0000-4000-8000-000000000101'$q$,'23514');
SELECT pg_temp.expect_error($q$INSERT INTO jobs SELECT (jsonb_populate_record(NULL::jobs,to_jsonb(j) || jsonb_build_object('id','00000000-0000-4000-8000-000000000999','request_json',jsonb_build_object('schemaVersion',1,'x',repeat('x',65536))))).* FROM jobs j WHERE id='00000000-0000-4000-8000-000000000101'$q$,'23514');
SELECT pg_temp.expect_error($q$INSERT INTO jobs SELECT (jsonb_populate_record(NULL::jobs,to_jsonb(j) || jsonb_build_object('id','00000000-0000-4000-8000-000000000999','finished_at',null))).* FROM jobs j WHERE id='00000000-0000-4000-8000-000000000101'$q$,'23514');
INSERT INTO artifacts(id,workspace_id,project_id,job_id,kind,object_key,object_version,sha256,bytes,status) VALUES
 ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101','source-manifest','fixture/a','1',repeat('a',64),10,'available'),
 ('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000102','source-manifest','fixture/a2','1',repeat('a',64),10,'available'),
 ('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000201','source-manifest','fixture/b','1',repeat('a',64),10,'available');
INSERT INTO snapshots(id,workspace_id,project_id,job_id,manifest_artifact_id,manifest_digest,template_digest,schema_digest,status) VALUES
 ('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000301',repeat('a',64),repeat('a',64),repeat('a',64),'candidate'),
 ('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000302',repeat('a',64),repeat('a',64),repeat('a',64),'candidate');
SELECT pg_temp.expect_error($q$UPDATE projects SET head_snapshot_id='00000000-0000-4000-8000-000000000402' WHERE id='00000000-0000-4000-8000-000000000011'$q$,'23503');
SELECT pg_temp.expect_error($q$UPDATE projects SET head_snapshot_id='00000000-0000-4000-8000-000000000401' WHERE id='00000000-0000-4000-8000-000000000021'$q$,'23503');
SELECT pg_temp.expect_error($q$UPDATE projects SET head_snapshot_id='00000000-0000-4000-8000-000000000401',revision=2 WHERE id='00000000-0000-4000-8000-000000000011'$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE snapshots SET manifest_digest=repeat('b',64) WHERE id='00000000-0000-4000-8000-000000000401'$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE snapshots SET status='verified' WHERE id='00000000-0000-4000-8000-000000000401'$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE artifacts SET object_version='2' WHERE id='00000000-0000-4000-8000-000000000301'$q$,'23514');
INSERT INTO approvals(id,workspace_id,project_id,job_id,actor_id,kind,subject_digest,state_version,decision,expires_at) VALUES
 ('00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','plan',repeat('a',64),3,'approve',now()+interval '1 hour');
SELECT pg_temp.expect_error($q$UPDATE approvals SET decision='reject'$q$,'23514');
SELECT pg_temp.expect_error($q$DELETE FROM approvals$q$,'23514');
INSERT INTO job_events(workspace_id,project_id,job_id,seq,type,schema_version,state_version,payload_json) VALUES
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101',1,'job.terminal',1,5,jsonb_build_object('schemaVersion',1,'workspaceId','00000000-0000-4000-8000-000000000010','projectId','00000000-0000-4000-8000-000000000011','jobId','00000000-0000-4000-8000-000000000101','seq',1,'stateVersion',5,'at',now(),'type','job.terminal','data',jsonb_build_object('state','CANCELLED','errorCode',null)));
SELECT pg_temp.expect_error($q$INSERT INTO job_events SELECT * FROM job_events$q$,'23505');
SELECT pg_temp.expect_error($q$DELETE FROM job_events$q$,'23514');
INSERT INTO workspace_quotas(workspace_id,period_start,limit_micros,max_active_jobs,max_previews) VALUES
 ('00000000-0000-4000-8000-000000000010',now(),100,2,2);
SELECT pg_temp.expect_error($q$UPDATE workspace_quotas SET reserved_micros=101$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE workspace_quotas SET spent_micros=60,reserved_micros=50$q$,'23514');
INSERT INTO job_steps(id,workspace_id,project_id,job_id,stage,attempt,status,available_at,input_digest) VALUES
 ('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101','PLANNING',1,'queued',now(),repeat('a',64));
SELECT pg_temp.expect_error($q$UPDATE job_steps SET status='running'$q$,'23514');
INSERT INTO usage_ledger(id,workspace_id,project_id,job_id,step_id,amount_micros,price_version,classification,dedupe_key) VALUES
 ('00000000-0000-4000-8000-000000000701','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000601',0,'fixture','estimated','fixture-usage-1');
SELECT pg_temp.expect_error($q$INSERT INTO usage_ledger SELECT '00000000-0000-4000-8000-000000000702',workspace_id,project_id,job_id,step_id,provider_request_id,input_tokens,output_tokens,amount_micros,price_version,classification,dedupe_key,created_at FROM usage_ledger$q$,'23505');
SELECT pg_temp.expect_error($q$DELETE FROM usage_ledger$q$,'23514');
INSERT INTO audit_events(id,workspace_id,actor_kind,actor_id,action,resource_id,request_id,outcome,metadata_json) VALUES
 ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000010','user','00000000-0000-4000-8000-000000000001','fixture-check','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000901','allowed','{"schemaVersion":1}');
SELECT pg_temp.expect_error($q$DELETE FROM audit_events$q$,'23514');
SELECT pg_temp.expect_error($q$DELETE FROM workspaces WHERE id='00000000-0000-4000-8000-000000000010'$q$,'23503');
-- Session lifetime, approval expiry, uncertain reservations and scoped replay keys.
SELECT pg_temp.expect_error($q$INSERT INTO sessions(id_hash,user_id,csrf_hash,expires_at) VALUES(repeat('a',64),'00000000-0000-4000-8000-000000000001',repeat('b',64),now()+interval '13 hours')$q$,'23514');
SELECT pg_temp.expect_error($q$INSERT INTO approvals SELECT (jsonb_populate_record(NULL::approvals,to_jsonb(a) || jsonb_build_object('id','00000000-0000-4000-8000-000000000999','state_version',4,'expires_at',now()-interval '1 second'))).* FROM approvals a$q$,'23514');
INSERT INTO usage_reservations(id,workspace_id,project_id,job_id,reserved_micros,settled_micros,status,expires_at) VALUES
 ('00000000-0000-4000-8000-000000000910','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101',100,0,'uncertain',now()+interval '1 day');
SELECT pg_temp.expect_error($q$UPDATE usage_reservations SET settled_micros=101$q$,'23514');
SELECT pg_temp.expect_error($q$INSERT INTO usage_reservations SELECT (jsonb_populate_record(NULL::usage_reservations,to_jsonb(r) || jsonb_build_object('id','00000000-0000-4000-8000-000000000911'))).* FROM usage_reservations r$q$,'23505');
INSERT INTO idempotency_records(workspace_id,actor_id,route,key,request_digest,response_status,response_json,expires_at) VALUES
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','/api/v1/projects','fixture-key-00001',repeat('a',64),201,'{"schemaVersion":1}',now()+interval '1 day');
SELECT pg_temp.expect_error($q$INSERT INTO idempotency_records SELECT * FROM idempotency_records$q$,'23505');
SELECT pg_temp.expect_error($q$INSERT INTO job_events SELECT (jsonb_populate_record(NULL::job_events,to_jsonb(e) || jsonb_build_object('seq',2))).* FROM job_events e$q$,'23514');
-- Verify RLS under a non-owner/non-superuser role, never as the migration owner.
CREATE ROLE e0_constraint_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA forge_control TO e0_constraint_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA forge_control TO e0_constraint_reader;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA forge_control TO e0_constraint_reader;
SET LOCAL ROLE e0_constraint_reader;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM projects),'missing tenant context must deny reads');
SELECT set_config('forge.workspace_id','00000000-0000-4000-8000-000000000010',true);
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM projects),'tenant A can see exactly two projects');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM projects WHERE workspace_id='00000000-0000-4000-8000-000000000020'),'tenant B must be hidden');
SELECT pg_temp.expect_error($q$UPDATE projects SET workspace_id='00000000-0000-4000-8000-000000000020' WHERE id='00000000-0000-4000-8000-000000000011'$q$,'42501');
SELECT set_config('forge.workspace_id','',true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM projects),'cleared context must deny reads');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='forge_control' AND c.relname IN ('workspaces','projects','jobs','snapshots','job_events','approvals','artifacts','usage_ledger','audit_events')),'RLS must be forced');
ROLLBACK;
