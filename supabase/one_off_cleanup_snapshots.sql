-- One-time cleanup of pre-sync campaign/batch snapshots.
--
-- Background:
--   Before migration 0003, every call to scheduleJob() created a fresh
--   campaigns + batches row (a "snapshot") because the editor lived in
--   localStorage. After the refactor, the editor IS the batch row, so those
--   old snapshots will show up as duplicate campaigns in the sidebar the
--   first time you load /api/sync.
--
-- What this does:
--   Deletes every campaign for the given user. Cascades through batches,
--   contacts, send_jobs, send_recipients, and email_artifacts. Does NOT
--   touch app_users or google_accounts — your auth/refresh-token state is
--   preserved, so you stay logged in after running this.
--
-- When to run:
--   * After applying 0003_editor_state.sql.
--   * Before the first time you load the new app (otherwise you'll have to
--     re-create Campaign 1 anyway).
--   * Once per affected user.
--
-- Important: this also wipes send_jobs / send_recipients history. If you
-- want to keep that audit trail, skip this script and just delete the stale
-- campaigns by hand from the sidebar.
--
-- How to use:
--   1. Set the email below.
--   2. Run the SELECT first to preview what will be deleted.
--   3. Run the DELETE.

-- ─── Step 1: preview ──────────────────────────────────────────────────────
select
  c.id                       as campaign_id,
  c.name                     as campaign_name,
  c.created_at               as campaign_created_at,
  (select count(*) from public.batches  b where b.campaign_id = c.id) as batches,
  (select count(*) from public.contacts ct
     join public.batches b on b.id = ct.batch_id
    where b.campaign_id = c.id)                                       as contacts,
  (select count(*) from public.send_jobs j
     join public.batches b on b.id = j.batch_id
    where b.campaign_id = c.id)                                       as jobs
from public.campaigns c
where c.user_id = (
  select id from public.app_users where email = 'andy.liu@gradientboostedinvestments.com'
)
order by c.created_at;

-- ─── Step 2: delete (uncomment and run after reviewing the preview) ───────
-- delete from public.campaigns
-- where user_id = (
--   select id from public.app_users where email = 'andy.liu@gradientboostedinvestments.com'
-- );
