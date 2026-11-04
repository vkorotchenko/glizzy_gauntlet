CREATE TABLE profile_photos (
    user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
    id uuid NOT NULL UNIQUE,
    bytes bigint NOT NULL CHECK (bytes > 0)
);
