-- Run if Pro templates exist but tier was not set (e.g. insert skipped or schema cache lag)
-- Also use after adding tier column: Supabase Dashboard → Settings → API → Reload schema

UPDATE prompt_templates
SET tier = 'pro'
WHERE name IN (
  'Cover Letter (CO-STAR Pro)',
  'Code Review (Staff Engineer)',
  'Research Assistant (Deep)',
  'Socratic Tutor',
  'Decision Memo (Executive)',
  'PRD Writer (Product)',
  'Explain Like Im Teaching'
);

-- Verify
SELECT name, tier, length(template) AS template_len
FROM prompt_templates
WHERE tier = 'pro'
ORDER BY name;
