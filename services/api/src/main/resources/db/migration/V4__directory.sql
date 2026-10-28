CREATE TABLE directory_venues (
    id uuid PRIMARY KEY,
    current_revision uuid,
    hidden boolean NOT NULL DEFAULT false
);
CREATE TABLE directory_contributions (
    id uuid PRIMARY KEY,
    venue_id uuid NOT NULL REFERENCES directory_venues(id),
    contributor_id uuid NOT NULL REFERENCES app_users(id),
    base_revision uuid REFERENCES directory_contributions(id),
    name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
    address varchar(300) NOT NULL CHECK (length(btrim(address)) > 0),
    description varchar(2000) NOT NULL,
    latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    status varchar(8) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED')),
    review_reason varchar(500) NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE directory_venues ADD FOREIGN KEY (current_revision) REFERENCES directory_contributions(id);
CREATE INDEX directory_contributions_user ON directory_contributions(contributor_id, created_at DESC);
CREATE INDEX directory_contributions_queue ON directory_contributions(created_at, id) WHERE status = 'PENDING';
CREATE INDEX directory_contributions_coordinates ON directory_contributions(latitude, longitude);
CREATE TABLE directory_menu_items (
    id uuid PRIMARY KEY,
    contribution_id uuid NOT NULL REFERENCES directory_contributions(id) ON DELETE CASCADE,
    position integer NOT NULL,
    name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
    description varchar(1000) NOT NULL,
    UNIQUE (id, contribution_id),
    UNIQUE (contribution_id, position)
);
CREATE TABLE directory_photos (
    id uuid PRIMARY KEY,
    contribution_id uuid NOT NULL REFERENCES directory_contributions(id) ON DELETE CASCADE,
    menu_item_id uuid,
    bytes bigint NOT NULL CHECK (bytes > 0),
    FOREIGN KEY (menu_item_id, contribution_id) REFERENCES directory_menu_items(id, contribution_id)
);
CREATE TABLE directory_events (
    id uuid PRIMARY KEY,
    venue_id uuid NOT NULL REFERENCES directory_venues(id),
    contribution_id uuid REFERENCES directory_contributions(id) ON DELETE SET NULL,
    actor_id uuid NOT NULL REFERENCES app_users(id),
    action varchar(20) NOT NULL,
    reason varchar(500) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE competition_featured_venues (
    competition_id uuid NOT NULL REFERENCES competitions(id),
    venue_id uuid NOT NULL REFERENCES directory_venues(id),
    PRIMARY KEY (competition_id, venue_id)
);
