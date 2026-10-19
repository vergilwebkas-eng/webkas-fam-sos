-- Allow both supported administrator roles to review private payment screenshots.
-- The application recognizes admin and admin_utama, so storage authorization must match.
drop policy if exists proofs_read_owner_or_admin on storage.objects;
create policy proofs_read_owner_or_admin
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payment-proofs'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select ((auth.jwt() -> 'app_metadata') ->> 'role')) in ('admin', 'admin_utama')
  )
);
