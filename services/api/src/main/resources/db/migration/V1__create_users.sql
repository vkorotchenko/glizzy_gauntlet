CREATE TABLE app_users (
    id UUID PRIMARY KEY,
    display_name VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT app_users_display_name_nonblank CHECK (length(trim(display_name)) > 0)
);
