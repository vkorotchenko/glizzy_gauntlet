CREATE TABLE meal_reactions (
    entry_id uuid NOT NULL REFERENCES competition_entries(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (entry_id, user_id)
);
