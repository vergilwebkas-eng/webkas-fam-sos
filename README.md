# WEBKAS — STREET OF STYLE FAMILY

React + Vite starter UI connected to the existing Supabase schema for member dues, manual payment verification, and admin operations.

## Included
- Email/password sign-in using Supabase Auth
- Member dashboard and own payment history
- Submit a dues payment with screenshot (JPG/PNG/WEBP, max 5 MB)
- Admin review queue: approve/reject pending submissions
- Private proof screenshot viewing via short-lived signed URL
- Admin dues setting editor
- Member list and deactivate member status
- Responsive dark/gold UI for mobile and desktop

## Setup
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the project's URL and publishable/anon key. Never put a service-role/secret key in the frontend.
4. Run `npm install`, then `npm run dev`.
5. Run `npm run build` before deployment.

## Important deployment blockers
- The Supabase project database has the four core tables and private `payment-proofs` bucket, and the private `create-member` Edge Function is now deployed with JWT verification and an `app_metadata.role === "admin"` authorization check.
- The `create-member` form calls `supabase.functions.invoke('create-member')`. The `create-member` Edge Function is deployed. It verifies the caller role, creates the Auth user server-side, and writes the profile. The service-role key is never used in the frontend.
- The admin role must be assigned by a trusted server-side process to `app_metadata.role = "admin"`. Do not let users set their own admin role through `user_metadata`.
- This app does not move money or verify bank transfers automatically. Admin decisions are manual.
- The current frontend deactivates a member profile instead of deleting the Auth user. Hard deletion needs a privileged server-side endpoint and should revoke sessions as part of the process.
- Before production, test RLS policies with separate member/admin accounts, configure Auth redirect URLs, and deploy to a host such as Vercel or Netlify.

## Database assumptions
Tables: `member_profiles`, `dues_settings`, `payment_submissions`, `cash_ledger`; storage bucket: `payment-proofs`. Payment approvals are expected to create ledger rows via the existing database trigger.
