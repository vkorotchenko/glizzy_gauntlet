ALTER TABLE competitions
    ADD COLUMN tracking_mode varchar(10) NOT NULL DEFAULT 'BOTH'
    CHECK (tracking_mode IN ('COUNT', 'LENGTH', 'BOTH'));

ALTER TABLE meal_revisions DROP CONSTRAINT meal_revisions_total_hundredths_check;
ALTER TABLE meal_revisions
    ADD CHECK (total_hundredths >= 0),
    ADD CHECK (total_hundredths > 0 OR whole_hot_dogs > 0);

ALTER TABLE competition_entries DROP CONSTRAINT competition_entries_adjusted_total_hundredths_check;
ALTER TABLE competition_entries
    ADD CHECK (adjusted_total_hundredths BETWEEN 0 AND 20199980),
    ADD CHECK (adjusted_total_hundredths IS NULL OR adjusted_total_hundredths > 0 OR adjusted_whole_hot_dogs > 0);

ALTER TABLE competition_result_entries DROP CONSTRAINT competition_result_entries_total_hundredths_check;
ALTER TABLE competition_result_entries
    ADD CHECK (total_hundredths >= 0),
    ADD CHECK (total_hundredths > 0 OR whole_hot_dogs > 0);
