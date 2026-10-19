-- Keep account deletion and delivery-event lookups bounded as the outbox grows.
create index grader_nurture_delivery_events_outbox_idx
  on public.grader_nurture_delivery_events(outbox_id);
