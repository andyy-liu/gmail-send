-- Atomic rename for custom variables. Used to live in application code as
-- four separate UPDATEs (variable row, batches templates, contacts.custom_fields,
-- send_recipients.custom_fields) — a mid-failure left the system half-renamed.
-- Functions in Postgres run inside a single implicit transaction, so any error
-- raised here rolls back everything.

create or replace function public.rename_custom_variable(
  p_user_id uuid,
  p_variable_id uuid,
  p_new_name text
) returns table (
  id uuid,
  name text,
  enabled boolean,
  "position" integer,
  rewritten_templates integer
)
language plpgsql
security definer
as $$
-- OUT parameter names from RETURNS TABLE (id, name, enabled, position) shadow
-- the matching custom_variables columns. Prefer the column so unqualified
-- references inside UPDATE/WHERE clauses resolve correctly.
#variable_conflict use_column
declare
  v_old_name text;
  v_pattern text;
  v_count integer;
begin
  -- Lock the variable row to serialise renames against each other.
  select cv.name into v_old_name
  from public.custom_variables cv
  where cv.id = p_variable_id and cv.user_id = p_user_id
  for update;

  if v_old_name is null then
    raise exception 'Variable not found' using errcode = 'P0002';
  end if;

  -- Caller may submit the current name; treat as no-op so the UI flow is simple.
  if v_old_name = p_new_name then
    return query
      select cv.id, cv.name, cv.enabled, cv.position, 0::integer
      from public.custom_variables cv
      where cv.id = p_variable_id;
    return;
  end if;

  -- Reject duplicates explicitly so the caller gets the unique-violation code
  -- regardless of timing on the unique index.
  if exists (
    select 1 from public.custom_variables
    where user_id = p_user_id
      and name = p_new_name
      and id <> p_variable_id
  ) then
    raise unique_violation using message = format('A variable named "%s" already exists.', p_new_name);
  end if;

  -- Variable names are restricted to [A-Za-z][A-Za-z0-9_]* by app validation,
  -- so direct interpolation into the regex is safe (no regex metacharacters).
  v_pattern := '\{\{[[:space:]]*' || v_old_name || '[[:space:]]*\}\}';

  with updated as (
    update public.batches
    set subject = regexp_replace(subject, v_pattern, '{{' || p_new_name || '}}', 'g'),
        body_html = regexp_replace(body_html, v_pattern, '{{' || p_new_name || '}}', 'g'),
        signature_html = regexp_replace(signature_html, v_pattern, '{{' || p_new_name || '}}', 'g')
    where user_id = p_user_id
      and (
        subject ~ v_pattern
        or body_html ~ v_pattern
        or signature_html ~ v_pattern
      )
    returning 1
  )
  select count(*)::integer into v_count from updated;

  -- Rename the jsonb key in stored contacts.
  update public.contacts
  set custom_fields = (custom_fields - v_old_name)
    || jsonb_build_object(p_new_name, custom_fields -> v_old_name)
  where user_id = p_user_id and custom_fields ? v_old_name;

  -- Mirror the rename onto recipient snapshots so any in-flight job that
  -- references {{NewName}} substitutes correctly.
  update public.send_recipients
  set custom_fields = (custom_fields - v_old_name)
    || jsonb_build_object(p_new_name, custom_fields -> v_old_name)
  where user_id = p_user_id and custom_fields ? v_old_name;

  -- Rename the variable last so a failure above leaves templates intact.
  update public.custom_variables
  set name = p_new_name
  where id = p_variable_id and user_id = p_user_id;

  return query
    select cv.id, cv.name, cv.enabled, cv.position, v_count
    from public.custom_variables cv
    where cv.id = p_variable_id;
end;
$$;

revoke execute on function public.rename_custom_variable(uuid, uuid, text) from anon, authenticated;
grant execute on function public.rename_custom_variable(uuid, uuid, text) to service_role;
