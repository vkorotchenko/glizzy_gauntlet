ALTER TABLE meal_items DROP CONSTRAINT meal_items_unit_hundredths_check;
ALTER TABLE meal_items DROP CONSTRAINT meal_items_check;
ALTER TABLE meal_items
    ADD CHECK (unit_hundredths BETWEEN 0 AND 10000),
    ADD CHECK (
        (unit_hundredths = 0 AND partial_hundredths = 0)
        OR (unit_hundredths > 0 AND partial_hundredths >= 0 AND partial_hundredths < unit_hundredths)
    ),
    ADD COLUMN condiments varchar(40)[] NOT NULL DEFAULT '{}',
    ADD CHECK (cardinality(condiments) <= 12 AND array_position(condiments, NULL) IS NULL);
