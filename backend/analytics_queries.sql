-- Mind World growth/activation dashboard queries.
-- Run these directly in the Supabase SQL editor (or via the MCP execute_sql tool).
-- Backed by: growth_events (migration 013), prompt_feedback, users.

-- ============================================================
-- 1. Daily active users (anyone who used Improve that day)
-- ============================================================
select
  date_trunc('day', created_at) as day,
  count(distinct user_id) as dau
from growth_events
where event = 'improve_used'
group by 1
order by 1 desc;

-- ============================================================
-- 2. Weekly funnel: connected -> improve_used -> autosave_used
-- (counts of distinct users per event per week — not a strict cohort,
-- but a fast read on whether activation is happening at all)
-- ============================================================
select
  date_trunc('week', created_at) as week,
  event,
  count(distinct user_id) as users
from growth_events
group by 1, 2
order by 1 desc, 2;

-- ============================================================
-- 3. Activation rate: % of newly-connected users who reach first
-- Improve within 24h and within 7 days
-- ============================================================
with first_connect as (
  select user_id, min(created_at) as connected_at
  from growth_events where event = 'connected'
  group by user_id
),
first_improve as (
  select user_id, min(created_at) as improved_at
  from growth_events where event = 'improve_used'
  group by user_id
)
select
  count(*) as connected_users,
  count(fi.user_id) filter (
    where fi.improved_at <= fc.connected_at + interval '24 hours'
  ) as activated_24h,
  count(fi.user_id) filter (
    where fi.improved_at <= fc.connected_at + interval '7 days'
  ) as activated_7d,
  round(
    100.0 * count(fi.user_id) filter (
      where fi.improved_at <= fc.connected_at + interval '7 days'
    ) / greatest(count(*), 1),
    1
  ) as activation_rate_7d_pct
from first_connect fc
left join first_improve fi using (user_id);

-- ============================================================
-- 4. D7 retention: of users whose first Improve was 7-14+ days ago,
-- what % used Improve again 7+ days after their first use
-- ============================================================
with first_use as (
  select user_id, min(created_at) as first_at
  from growth_events where event = 'improve_used'
  group by user_id
)
select
  count(*) as cohort_size,
  count(g.user_id) as retained_d7,
  round(100.0 * count(g.user_id) / greatest(count(*), 1), 1) as retention_d7_pct
from first_use f
left join growth_events g
  on g.user_id = f.user_id
  and g.event = 'improve_used'
  and g.created_at > f.first_at + interval '7 days'
where f.first_at < now() - interval '7 days';

-- ============================================================
-- 5. Improve calls per active user per week (engagement depth)
-- ============================================================
select
  date_trunc('week', created_at) as week,
  count(*) as total_improve_calls,
  count(distinct user_id) as active_users,
  round(count(*)::numeric / greatest(count(distinct user_id), 1), 2) as calls_per_active_user
from growth_events
where event = 'improve_used'
group by 1
order by 1 desc;

-- ============================================================
-- 6. Platform breakdown (which AI chat sites drive usage)
-- ============================================================
select platform, count(*) as improve_calls, count(distinct user_id) as users
from growth_events
where event = 'improve_used' and platform is not null
group by 1
order by 2 desc;

-- ============================================================
-- 7. Quality proxy: net prompt rating + unedited-accept rate, weekly
-- (answers the north-star question: are outputs good enough to send as-is?)
-- ============================================================
select
  date_trunc('week', created_at) as week,
  count(*) filter (where rating = 1) as thumbs_up,
  count(*) filter (where rating = -1) as thumbs_down,
  sum(rating) as net_rating,
  round(
    100.0 * count(*) filter (where accepted_unedited) /
      greatest(count(*) filter (where event_type = 'edit_feedback'), 1),
    1
  ) as pct_unedited_accept
from prompt_feedback
group by 1
order by 1 desc;

-- ============================================================
-- 8. Free-tier quota exhaustion (willingness-to-pay proxy)
-- ============================================================
select
  count(*) filter (where improve_calls_used >= 25) as users_hit_quota,
  count(*) as total_free_users,
  round(
    100.0 * count(*) filter (where improve_calls_used >= 25) / greatest(count(*), 1),
    1
  ) as pct_hit_quota
from users
where is_pro is not true;

-- ============================================================
-- 9. Memory fuel: auto-save volume over time (is the "upload once,
-- never again" promise actually being kept?)
-- ============================================================
select
  date_trunc('week', created_at) as week,
  count(*) as autosaves,
  count(distinct user_id) as users
from growth_events
where event = 'autosave_used'
group by 1
order by 1 desc;

-- ============================================================
-- 10. Degraded memory search: Improve calls that fell back to the
-- opening-only conversation search (fallback_error = chunk search failed
-- or timed out; fallback_no_chunks = user not chunk-indexed yet) or ran
-- without keyword search. Should be near zero next to improve_used.
-- ============================================================
select
  date_trunc('day', created_at) as day,
  event,
  count(*) as calls,
  count(distinct user_id) as users
from growth_events
where event in ('improve_used', 'retrieval_fallback_error',
                'retrieval_fallback_no_chunks', 'retrieval_keyword_failed')
  and created_at > now() - interval '14 days'
group by 1, 2
order by 1 desc, 2;
