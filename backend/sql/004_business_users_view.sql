-- Read-only projection; the Auth module remains responsible for all user writes.
CREATE OR REPLACE VIEW business_user_profiles AS
SELECT id, email,
  COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.name')), ''), SUBSTRING_INDEX(email, '@', 1)) AS name,
  LOWER(role) AS role
FROM users;
