ALTER TABLE competitions
    ADD COLUMN cover_photo_id uuid UNIQUE,
    ADD COLUMN cover_photo_bytes bigint NOT NULL DEFAULT 0,
    ADD CONSTRAINT competitions_cover_photo_check CHECK (
        (cover_photo_id IS NULL AND cover_photo_bytes = 0)
        OR (cover_photo_id IS NOT NULL AND cover_photo_bytes > 0)
    );
