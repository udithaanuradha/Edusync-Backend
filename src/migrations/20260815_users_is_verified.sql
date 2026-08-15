-- Add is_verified flag to users for Edusync email-verification enforcement
-- Root cause: POST /api/verify-otp correctly checked the OTP code/expiry but
-- never recorded anywhere that the user had actually verified, so
-- POST /api/login (email+password only) let unverified accounts log in
-- freely. This migration adds the single column that /api/verify-otp and
-- /api/login now read/write.
-- TiDB/MySQL compatible DDL. Each statement below is kept separate, per the
-- "Unsupported operate same column" restriction discovered in
-- 20260428_users_constraints.sql.

-- 1. New column. Defaults FALSE so newly-inserted users start unverified
--    until they complete /api/verify-otp.
ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Grandfather in existing accounts: only a user who has already logged
--    in at least once (last_login IS NOT NULL) is treated as an established,
--    already-active account and is marked verified. Accounts that have
--    never logged in start unverified, per the fix's requirement, even
--    though they predate this flag and may never have gone through the OTP
--    flow at all.
--    Confirmed against live data on 2026-08-15: 118 total users, 57 with
--    last_login IS NOT NULL (become is_verified = TRUE), 61 with
--    last_login IS NULL (stay is_verified = FALSE). Re-check before you run
--    this yourself with:
--      SELECT COUNT(*) FROM users WHERE last_login IS NOT NULL;
UPDATE users SET is_verified = TRUE WHERE last_login IS NOT NULL;
