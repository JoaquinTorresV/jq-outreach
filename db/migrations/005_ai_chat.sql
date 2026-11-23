alter table contacts
  add column ai_enabled boolean not null default true,
  add column ai_handoff_at timestamptz,
  add column ai_last_action text;

create index contacts_ai_enabled_idx on contacts(ai_enabled) where ai_enabled;
