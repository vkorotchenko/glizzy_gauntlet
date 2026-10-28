CREATE TABLE meals (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES app_users(id),
    version bigint NOT NULL DEFAULT 1,
    archived boolean NOT NULL DEFAULT false,
    current_revision uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX meals_owner ON meals(owner_id, created_at DESC, id);
CREATE TABLE meal_revisions (
    id uuid PRIMARY KEY,
    meal_id uuid NOT NULL REFERENCES meals(id),
    version bigint NOT NULL,
    eaten_at timestamptz NOT NULL,
    venue_id uuid REFERENCES directory_venues(id),
    location varchar(500) NOT NULL,
    notes varchar(2000) NOT NULL,
    total_hundredths bigint NOT NULL CHECK (total_hundredths > 0),
    whole_hot_dogs integer NOT NULL CHECK (whole_hot_dogs >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (meal_id, version),
    UNIQUE (meal_id, id)
);
ALTER TABLE meals ADD FOREIGN KEY (id, current_revision) REFERENCES meal_revisions(meal_id, id);
CREATE TABLE meal_items (
    revision_id uuid NOT NULL REFERENCES meal_revisions(id),
    position integer NOT NULL,
    name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
    whole_quantity integer NOT NULL CHECK (whole_quantity BETWEEN 0 AND 100),
    unit_hundredths integer NOT NULL CHECK (unit_hundredths BETWEEN 1 AND 10000),
    partial_hundredths integer NOT NULL CHECK (partial_hundredths >= 0 AND partial_hundredths < unit_hundredths),
    CHECK (whole_quantity > 0 OR partial_hundredths > 0),
    PRIMARY KEY (revision_id, position)
);
CREATE TABLE meal_photos (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES app_users(id),
    meal_id uuid REFERENCES meals(id),
    bytes bigint NOT NULL CHECK (bytes > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX meal_photos_owner ON meal_photos(owner_id);
CREATE TABLE meal_revision_photos (
    revision_id uuid NOT NULL REFERENCES meal_revisions(id),
    photo_id uuid NOT NULL REFERENCES meal_photos(id),
    PRIMARY KEY (revision_id, photo_id)
);
CREATE TABLE competition_entries (
    id uuid PRIMARY KEY,
    meal_id uuid NOT NULL REFERENCES meals(id),
    competition_id uuid NOT NULL REFERENCES competitions(id),
    competition_name varchar(120) NOT NULL,
    revision_id uuid NOT NULL,
    withdrawn boolean NOT NULL DEFAULT false,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (meal_id, revision_id) REFERENCES meal_revisions(meal_id, id),
    UNIQUE (meal_id, competition_id)
);
CREATE INDEX competition_entries_competition ON competition_entries(competition_id, created_at DESC, id);
CREATE TABLE competition_entry_events (
    id uuid PRIMARY KEY,
    entry_id uuid NOT NULL REFERENCES competition_entries(id),
    actor_id uuid NOT NULL REFERENCES app_users(id),
    action varchar(30) NOT NULL,
    before_revision uuid REFERENCES meal_revisions(id),
    after_revision uuid NOT NULL REFERENCES meal_revisions(id),
    was_withdrawn boolean,
    is_withdrawn boolean NOT NULL,
    reason varchar(500) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE meal_mutations (
    owner_id uuid NOT NULL REFERENCES app_users(id),
    request_id uuid NOT NULL,
    fingerprint char(64) NOT NULL,
    meal_id uuid NOT NULL REFERENCES meals(id),
    PRIMARY KEY (owner_id, request_id)
);
