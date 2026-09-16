-- Hand-edited migration (PRD Part A, "Case-insensitive uniqueness").
--
-- FR-LBL-1 requires label names to be unique per workspace, compared
-- case-insensitively. Prisma's schema language cannot express a functional index on
-- lower(name), so it is created here directly.
--
-- IMPORTANT: because this index is invisible to schema.prisma, `prisma migrate dev`
-- may propose a migration that DROPS it. Never accept such a migration — see README,
-- "Hand-written migrations".

CREATE UNIQUE INDEX "uq_labels_workspace_lower_name" ON "labels" ("workspace_id", lower("name"));
