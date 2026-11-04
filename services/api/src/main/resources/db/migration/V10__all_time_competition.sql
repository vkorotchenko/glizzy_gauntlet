ALTER TABLE competitions ADD COLUMN all_time boolean NOT NULL DEFAULT false;
ALTER TABLE competitions ALTER COLUMN organizer_id DROP NOT NULL;
ALTER TABLE competitions ALTER COLUMN ends_at DROP NOT NULL;
ALTER TABLE competitions ADD CONSTRAINT competition_lifetime CHECK (
    (all_time AND organizer_id IS NULL AND ends_at IS NULL AND published_at IS NOT NULL AND visibility = 'PUBLIC')
    OR (NOT all_time AND organizer_id IS NOT NULL AND ends_at IS NOT NULL)
);
CREATE UNIQUE INDEX single_all_time_competition ON competitions(all_time) WHERE all_time;
ALTER TABLE competition_memberships DROP CONSTRAINT competition_memberships_status_check;
ALTER TABLE competition_memberships ADD CHECK (status IN ('ACTIVE', 'EXCLUDED', 'LEFT'));

INSERT INTO competitions (id, name, rules, visibility, time_zone, starts_at,
    allow_shared_meals, tracking_mode, published_at, all_time)
VALUES ('00000000-0000-4000-8000-000000000000', 'All-time Glizzy Gauntlet',
    'A permanent, friendly hot dog count leaderboard. Submit meals explicitly to share them with members. Leave at any time to withdraw your submissions; private meal records remain yours.',
    'PUBLIC', 'UTC', '1970-01-01T00:00:00Z', true, 'COUNT', clock_timestamp(), true);
INSERT INTO competition_memberships (competition_id, user_id)
SELECT '00000000-0000-4000-8000-000000000000', id FROM app_users;
