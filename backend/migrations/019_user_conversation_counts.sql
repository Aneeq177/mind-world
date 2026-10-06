-- Per-user conversation totals, computed on read so they can't drift from
-- knowledge_nodes (one row per saved conversation).
--
-- security_invoker keeps the view from bypassing RLS, and it is revoked from
-- anon/authenticated so emails aren't reachable through the Data API.

CREATE OR REPLACE VIEW user_conversation_counts
WITH (security_invoker = true) AS
SELECT
  u.id AS user_id,
  u.email,
  count(k.id) AS conversation_count
FROM users u
LEFT JOIN knowledge_nodes k ON k.user_id = u.id
GROUP BY u.id, u.email;

REVOKE ALL ON TABLE user_conversation_counts FROM anon, authenticated;
GRANT SELECT ON TABLE user_conversation_counts TO service_role;
