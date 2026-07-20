-- drop+create targets view (column set changes); others via replace
drop view if exists console_campaign_targets;

create view console_campaign_targets as
select o.id,
       o.event_id,
       o.campaign_id,
       o.contact_id,
       o.status,
       o.current_step_index,
       o.next_run_at,
       o.reached_at,
       o.reached_channel,
       o.stop_reason,
       g.full_name as guest_name,
       case when has_platform_permission('view_customer_data')
            then c.normalized_phone end as phone
from outreach_state o
left join contacts c on c.id = o.contact_id
left join guests g on g.event_id = o.event_id
  and regexp_replace(replace(g.phone, '-', ''), '^0', '+972') = c.normalized_phone
where is_console_agent();

create or replace view console_me as
select ca.user_id,
       ca.display_name,
       ca.vox_username,
       coalesce(pr.name, '') as platform_role,
       coalesce(pr.rank, 0)  as platform_rank,
       case
         when coalesce(pr.is_owner_role, false)
           then (select coalesce(array_agg(key), '{}') from platform_permission_definitions)
         else coalesce((select array_agg(pd.key)
                        from platform_role_permissions prp
                        join platform_permission_definitions pd on pd.id = prp.permission_id
                        where prp.role_id = pr.id), '{}')
       end as permissions
from console_agents ca
left join platform_staff ps on ps.user_id = ca.user_id
left join platform_roles pr on pr.id = ps.role_id
where ca.user_id = auth.uid();

create or replace view console_events as
select e.id as event_id,
       e.name as event_name,
       e.event_type::text as event_type,
       e.event_date,
       exists (select 1 from campaigns c where c.event_id = e.id) as has_campaign
from events e
where (e.with_ai_calls = true
       or exists (select 1 from campaigns c where c.event_id = e.id))
  and is_console_agent();

revoke all on console_me, console_campaign_targets from anon, public;
grant select on console_me to authenticated;
grant select on console_campaign_targets to authenticated;;
