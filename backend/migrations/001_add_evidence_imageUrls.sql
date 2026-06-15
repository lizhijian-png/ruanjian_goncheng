-- Add imageUrls column to evidences table for submit-evidence page feature
ALTER TABLE evidences ADD COLUMN IF NOT EXISTS imageUrls TEXT NULL;
