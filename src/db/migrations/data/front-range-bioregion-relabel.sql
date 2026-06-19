-- Front Range bioregion relabel (instance data fix, rivr_bioregional_south_platte)
--
-- The region instance's home identity (PRIMARY_AGENT 59213ba7) was modeled as
-- "South Platte River Basin" (a watershed, placeType "basin"). The Front Range
-- is a *cultural bioregion*, distinct from the South Platte River Basin. This
-- migration repurposes the primary agent into the Front Range region (placeType
-- "region", which renders like a basin/region page, never an org), recreates
-- South Platte as a distinct child watershed basin, and parents the Colorado
-- locales under the region so they render as Front Range communities.
--
-- Idempotent: safe to re-run. No PRIMARY_AGENT_ID / env change (UUID is stable).

BEGIN;

-- 1) Repurpose the primary agent: South Platte basin -> Front Range region.
UPDATE agents
SET
  name = 'Front Range',
  description = 'The Front Range cultural bioregion — the communities along Colorado''s Front Range, spanning the South Platte and Colorado Headwaters watersheds.',
  metadata = (COALESCE(metadata, '{}'::jsonb) - 'huc6Code') || '{"placeType":"region"}'::jsonb,
  parent_id = NULL,
  path_ids = '{}'::uuid[],
  depth = 0,
  updated_at = now()
WHERE id = '59213ba7-801c-48ea-8ced-f3424ed78c0f';

-- 2) Recreate South Platte River Basin as a distinct child watershed of the
--    Front Range region (placeType "basin"), so the watershed remains its own
--    entity rather than being conflated with the bioregion.
INSERT INTO agents (id, name, type, description, visibility, parent_id, path_ids, metadata, depth)
VALUES (
  '5b0a7e00-0000-4000-8000-000000000001',
  'South Platte River Basin',
  'organization',
  'The South Platte River watershed along Colorado''s Front Range (HUC-6 101900).',
  'public',
  '59213ba7-801c-48ea-8ced-f3424ed78c0f',
  ARRAY['59213ba7-801c-48ea-8ced-f3424ed78c0f']::uuid[],
  '{"placeType":"basin","huc6Code":"101900"}'::jsonb,
  1
)
ON CONFLICT (id) DO NOTHING;

-- 3) Parent the Colorado locales under the Front Range region so they render as
--    Front Range communities (their metadata.basinId already points at the
--    primary agent, now the region).
UPDATE agents
SET parent_id = '59213ba7-801c-48ea-8ced-f3424ed78c0f',
    path_ids = ARRAY['59213ba7-801c-48ea-8ced-f3424ed78c0f']::uuid[],
    depth = 1,
    updated_at = now()
WHERE id IN (
  'a4622754-0a0f-4c7f-93ca-c432a1cfc3b0', -- Boulder
  '0a12f661-171b-44dd-af85-06baadb3ba56', -- Denver
  'c4f3cac0-a3eb-421d-afa3-d92db19615ca'  -- Longmont
);

COMMIT;
