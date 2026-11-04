ALTER TABLE competitions DROP CONSTRAINT competition_lifetime;
ALTER TABLE competitions ADD CONSTRAINT competition_lifetime CHECK (
    (all_time AND ends_at IS NULL AND published_at IS NOT NULL AND visibility = 'PUBLIC')
    OR (NOT all_time AND organizer_id IS NOT NULL AND ends_at IS NOT NULL)
);
CREATE INDEX competitions_organizer ON competitions(organizer_id, all_time DESC, created_at DESC, id);
