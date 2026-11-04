CREATE TABLE competition_invitation_emails (
    id uuid PRIMARY KEY,
    competition_id uuid NOT NULL REFERENCES competitions(id),
    email varchar(254) NOT NULL,
    status varchar(7) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
    last_error varchar(30),
    sent_at timestamptz,
    UNIQUE (competition_id, email)
);
CREATE TABLE competition_invitation_email_attempts (
    id uuid PRIMARY KEY,
    email_id uuid NOT NULL REFERENCES competition_invitation_emails(id),
    attempted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX invitation_email_attempted ON competition_invitation_email_attempts(attempted_at);
