CREATE TABLE competitions (
    id uuid PRIMARY KEY,
    organizer_id uuid NOT NULL REFERENCES app_users(id),
    name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
    rules varchar(5000) NOT NULL,
    visibility varchar(7) NOT NULL CHECK (visibility IN ('PUBLIC', 'PRIVATE')),
    time_zone varchar(80) NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
    allow_shared_meals boolean NOT NULL,
    published_at timestamptz,
    version bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX competitions_public ON competitions(created_at DESC, id)
    WHERE published_at IS NOT NULL AND visibility = 'PUBLIC';

CREATE TABLE competition_memberships (
    competition_id uuid NOT NULL REFERENCES competitions(id),
    user_id uuid NOT NULL REFERENCES app_users(id),
    status varchar(8) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXCLUDED')),
    joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (competition_id, user_id)
);
CREATE INDEX competition_memberships_user ON competition_memberships(user_id, competition_id);

CREATE TABLE competition_invitations (
    id uuid PRIMARY KEY,
    competition_id uuid NOT NULL REFERENCES competitions(id),
    token_hash char(64) NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);
CREATE INDEX competition_invitations_competition ON competition_invitations(competition_id);

CREATE TABLE competition_events (
    id uuid PRIMARY KEY,
    competition_id uuid NOT NULL REFERENCES competitions(id),
    actor_id uuid NOT NULL REFERENCES app_users(id),
    action varchar(40) NOT NULL,
    target_user_id uuid REFERENCES app_users(id),
    reason varchar(500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX competition_events_competition ON competition_events(competition_id, created_at DESC);
