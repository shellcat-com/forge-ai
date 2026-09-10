-- Reviewed synthetic reference schema, not provider output.
CREATE TABLE app.tasks (
 id uuid PRIMARY KEY,
 title varchar(200) NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX task_status ON app.tasks (status);