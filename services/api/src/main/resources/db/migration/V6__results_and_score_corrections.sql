ALTER TABLE competition_entries
    ADD COLUMN score_excluded boolean NOT NULL DEFAULT false,
    ADD COLUMN adjusted_total_hundredths bigint CHECK (adjusted_total_hundredths BETWEEN 1 AND 20199980),
    ADD COLUMN adjusted_whole_hot_dogs integer CHECK (adjusted_whole_hot_dogs BETWEEN 0 AND 2000),
    ADD CHECK ((adjusted_total_hundredths IS NULL) = (adjusted_whole_hot_dogs IS NULL)),
    ADD UNIQUE (competition_id, id);

CREATE TABLE competition_results (
    id uuid PRIMARY KEY,
    competition_id uuid NOT NULL REFERENCES competitions(id),
    version bigint NOT NULL CHECK (version > 0),
    calculation_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (competition_id, version),
    UNIQUE (id, competition_id)
);
ALTER TABLE competitions
    ADD COLUMN current_result_version bigint,
    ADD FOREIGN KEY (id, current_result_version) REFERENCES competition_results(competition_id, version);

CREATE TABLE competition_result_entries (
    result_id uuid NOT NULL,
    competition_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    owner_id uuid NOT NULL REFERENCES app_users(id),
    revision_id uuid NOT NULL REFERENCES meal_revisions(id),
    total_hundredths bigint NOT NULL CHECK (total_hundredths > 0),
    whole_hot_dogs integer NOT NULL CHECK (whole_hot_dogs >= 0),
    score_excluded boolean NOT NULL,
    PRIMARY KEY (result_id, entry_id),
    FOREIGN KEY (result_id, competition_id) REFERENCES competition_results(id, competition_id),
    FOREIGN KEY (competition_id, entry_id) REFERENCES competition_entries(competition_id, id)
);
CREATE TABLE competition_result_participants (
    result_id uuid NOT NULL REFERENCES competition_results(id),
    user_id uuid NOT NULL REFERENCES app_users(id),
    display_name varchar(80) NOT NULL,
    rank bigint NOT NULL CHECK (rank > 0),
    total_hundredths bigint NOT NULL CHECK (total_hundredths >= 0),
    whole_hot_dogs bigint NOT NULL CHECK (whole_hot_dogs >= 0),
    PRIMARY KEY (result_id, user_id)
);
CREATE INDEX result_participants_ranking ON competition_result_participants(result_id, rank, user_id);

CREATE TABLE entry_score_corrections (
    id uuid PRIMARY KEY,
    competition_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    actor_id uuid NOT NULL REFERENCES app_users(id),
    actor_display_name varchar(80) NOT NULL,
    request_id uuid NOT NULL,
    fingerprint char(64) NOT NULL,
    before_version bigint NOT NULL,
    after_version bigint NOT NULL,
    before_total_hundredths bigint NOT NULL,
    before_whole_hot_dogs integer NOT NULL,
    before_excluded boolean NOT NULL,
    after_total_hundredths bigint NOT NULL,
    after_whole_hot_dogs integer NOT NULL,
    after_excluded boolean NOT NULL,
    result_version bigint NOT NULL,
    reason varchar(500) NOT NULL CHECK (length(btrim(reason)) > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (actor_id, request_id),
    FOREIGN KEY (competition_id, entry_id) REFERENCES competition_entries(competition_id, id),
    FOREIGN KEY (competition_id, result_version) REFERENCES competition_results(competition_id, version)
);
CREATE INDEX corrections_competition ON entry_score_corrections(competition_id, created_at DESC, id);
