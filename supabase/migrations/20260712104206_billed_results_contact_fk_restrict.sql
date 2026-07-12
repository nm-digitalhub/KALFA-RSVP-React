-- P0-1 (A3): Harden the billed_results.contact_id FK: ON DELETE CASCADE -> ON DELETE RESTRICT.
-- A billed contact must NOT be hard-deletable, so the immutable billing row survives.
alter table public.billed_results
  drop constraint if exists billed_results_contact_id_fkey;

alter table public.billed_results
  add constraint billed_results_contact_id_fkey
    foreign key (contact_id) references public.contacts(id) on delete restrict;
