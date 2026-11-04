CREATE TABLE account_roles (
    user_id uuid NOT NULL REFERENCES app_users(id),
    role varchar(20) NOT NULL CHECK (role IN ('ADMIN', 'VENUE_APPROVER')),
    granted_by uuid REFERENCES app_users(id),
    granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, role)
);
CREATE INDEX account_roles_role ON account_roles(role, user_id);

CREATE TABLE account_role_events (
    id uuid PRIMARY KEY,
    actor_id uuid REFERENCES app_users(id),
    target_user_id uuid NOT NULL REFERENCES app_users(id),
    role varchar(20) NOT NULL CHECK (role IN ('ADMIN', 'VENUE_APPROVER')),
    action varchar(7) NOT NULL CHECK (action IN ('GRANTED', 'REVOKED')),
    reason varchar(500) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO account_roles (user_id, role)
SELECT id, 'ADMIN' FROM app_users WHERE site_owner;
INSERT INTO account_role_events (id, target_user_id, role, action, reason)
SELECT gen_random_uuid(), user_id, role, 'GRANTED', 'Imported legacy site-owner permission.'
FROM account_roles;
ALTER TABLE app_users DROP COLUMN site_owner;
