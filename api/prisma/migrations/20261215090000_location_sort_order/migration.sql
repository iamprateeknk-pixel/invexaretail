-- Admin-chosen display order for locations (the workspace location switcher, web and mobile).
-- Additive only: one column with a default, no existing data rewritten. Every existing row gets 0, so the
-- list keeps its previous order (oldest first, id as the tie-break) until an admin reorders it.
ALTER TABLE "Location" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
