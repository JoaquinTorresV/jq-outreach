-- jq-outreach · esquema inicial

create table accounts (
  id                   serial primary key,
  label                text not null,
  phone                text,
  status               text not null default 'desconectada'
                         check (status in ('desconectada','conectando','activa','qr_requerido','pausada_auto','pausada_manual','baneada')),
  status_reason        text,
  connection           text not null default 'closed' check (connection in ('closed','connecting','open')),
  paused_until         timestamptz,
  simulated            boolean not null default false,
  first_message_mode   text not null default 'manual' check (first_message_mode in ('manual','auto')),
  daily_new_cap        int not null default 50,
  daily_total_cap      int not null default 150,
  hourly_cap           int not null default 40,
  proxy_url            text,
  qr                   text,
  qr_at                timestamptz,
  pairing_code         text,
  wa_jid               text,
  cap_info             jsonb,
  consecutive_failures int not null default 0,
  last_error           text,
  last_heartbeat       timestamptz,
  last_connected_at    timestamptz,
  disconnected_since   timestamptz,
  last_sent_at         timestamptz,
  created_at           timestamptz not null default now()
);

-- Estado de autenticación de Baileys (reemplaza useMultiFileAuthState)
create table wa_auth_creds (
  account_id int primary key references accounts(id) on delete cascade,
  data       text not null,
  updated_at timestamptz not null default now()
);
create table wa_auth_keys (
  account_id int not null references accounts(id) on delete cascade,
  type       text not null,
  key_id     text not null,
  data       text not null,
  primary key (account_id, type, key_id)
);

create table import_batches (
  id         serial primary key,
  filename   text,
  created_at timestamptz not null default now(),
  total_rows int not null default 0,
  imported   int not null default 0,
  updated    int not null default 0,
  invalid    int not null default 0,
  duplicates int not null default 0,
  summary    jsonb not null default '{}'
);

create table contacts (
  id               bigserial primary key,
  phone            text not null unique,            -- E.164 con +
  jid              text,                            -- 569...@s.whatsapp.net (verificado)
  lid              text,
  name             text,
  first_name       text,
  business_name    text,
  address          text,
  city             text,
  category         text,
  email            text,
  instagram        text,
  facebook         text,
  website          text,
  extra            jsonb not null default '{}',
  batch_id         int references import_batches(id) on delete set null,
  source           text not null default 'import',
  account_id       int references accounts(id) on delete set null,
  stage            text not null default 'nuevo',
  stage_reason     text,
  step             int not null default 0,          -- mensajes salientes enviados (1 = primero ... 4 = tercer seguimiento)
  next_action_at   timestamptz,
  verify_attempts  int not null default 0,
  verified_at      timestamptz,
  failover_pending boolean not null default false,
  first_sent_at    timestamptz,
  last_outbound_at timestamptz,
  last_inbound_at  timestamptz,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index contacts_stage_idx   on contacts(stage);
create index contacts_acct_idx    on contacts(account_id, stage, next_action_at);
create index contacts_batch_idx   on contacts(batch_id);
create index contacts_lid_idx     on contacts(lid) where lid is not null;
create index contacts_verified_idx on contacts(verified_at) where verified_at is not null;

create table templates (
  id         serial primary key,
  step       int not null check (step between 1 and 4),
  kind       text not null default 'normal' check (kind in ('normal','failover')),
  name       text not null,
  body       text not null,
  requires   text[] not null default '{}',
  weight     int not null default 1 check (weight >= 1),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table messages (
  id            bigserial primary key,
  contact_id    bigint not null references contacts(id) on delete cascade,
  account_id    int references accounts(id) on delete set null,
  direction     text not null check (direction in ('out','in')),
  step          int,
  source        text not null default 'auto',      -- auto | manual | inbound
  body          text,
  body_hash     text,
  template_id   int,
  status        text not null default 'queued'
                  check (status in ('queued','sending','retry','sent','delivered','read','failed','unconfirmed','blocked','cancelled','received')),
  attempts      int not null default 0,
  retry_at      timestamptz,
  error_code    text,
  error_detail  text,
  wa_message_id text,
  dry_run       boolean not null default false,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  updated_at    timestamptz not null default now()
);
-- Idempotencia: un solo mensaje saliente por contacto y paso
create unique index messages_out_step_uniq on messages(contact_id, step) where direction = 'out' and step is not null;
create unique index messages_wa_id_uniq    on messages(account_id, wa_message_id) where wa_message_id is not null;
create index messages_status_idx on messages(status) where direction = 'out';
create index messages_sent_idx   on messages(account_id, sent_at) where direction = 'out';
create index messages_hash_idx   on messages(account_id, body_hash, sent_at) where direction = 'out';
create index messages_contact_idx on messages(contact_id, created_at);

create table events (
  id         bigserial primary key,
  ts         timestamptz not null default now(),
  level      text not null default 'info' check (level in ('info','warn','error','critical')),
  type       text not null,
  account_id int,
  contact_id bigint,
  message_id bigint,
  detail     jsonb not null default '{}'
);
create index events_ts_idx      on events(ts desc);
create index events_level_idx   on events(level, ts desc);
create index events_contact_idx on events(contact_id, ts desc);

create table settings (
  key   text primary key,
  value jsonb not null
);

create table commands (
  id         bigserial primary key,
  account_id int not null references accounts(id) on delete cascade,
  type       text not null,
  payload    jsonb not null default '{}',
  status     text not null default 'pending',   -- pending | done | error
  result     text,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);
create index commands_pending_idx on commands(status, created_at) where status = 'pending';

create table worker_status (
  worker_id  text primary key,
  started_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  info       jsonb not null default '{}'
);

create table alert_state (
  key       text primary key,
  last_sent timestamptz not null
);

-- Plantillas de ejemplo (editables desde el dashboard). Sintaxis:
--   {nombre}  {nombre|fallback}  {negocio}  {saludo}  [[Hola|Buenas|Qué tal]]
insert into templates (step, kind, name, body, weight) values
 (1,'normal','Apertura personalizada (nombre + negocio)',
  E'[[Hola|Buenas|Qué tal]] {nombre}, ¿cómo estás? Vi {negocio} y me pareció interesante lo que hacen. Trabajo ayudando a negocios a conseguir más clientes con automatización por WhatsApp. ¿Te puedo contar cómo sería en tu caso?', 2),
 (1,'normal','Apertura solo nombre',
  E'{saludo} {nombre}, ¿cómo estás? Trabajo ayudando a negocios a responder y captar clientes más rápido por WhatsApp. ¿Tienes un minuto para que te cuente cómo podría servirte?', 1),
 (1,'normal','Apertura genérica (sin datos)',
  E'{saludo}, ¿cómo estás? Trabajo ayudando a negocios a responder y captar clientes más rápido por WhatsApp. ¿Hablo con quien ve la parte comercial?', 1),
 (2,'normal','Seguimiento 1',
  E'[[Hola|Buenas]] {nombre|por acá}, te escribo de nuevo por si el mensaje anterior se te pasó. ¿Te interesa que te cuente cómo lo haríamos? Si no es por ahora, sin problema, dime y no te molesto más.', 1),
 (3,'normal','Seguimiento 2',
  E'{saludo} {nombre|}, sigo con el tema de captar más clientes por WhatsApp. Si te sirve te puedo mandar un ejemplo corto de cómo quedaría. ¿Te lo envío?', 1),
 (4,'normal','Seguimiento 3 (cierre)',
  E'[[Hola|Buenas]] {nombre|}, este es mi último mensaje para no ser pesado. Si más adelante quieres ver cómo automatizar tu atención por WhatsApp, aquí estoy. ¡Que te vaya muy bien!', 1),
 (2,'failover','Seguimiento 1 (desde otro número)',
  E'[[Hola|Buenas]] {nombre|por acá}, te escribo desde este otro número porque cambié de línea. Te había contactado antes por el tema de captar más clientes por WhatsApp, ¿te interesa que te cuente? Si no, dime y no te molesto más.', 1),
 (3,'failover','Seguimiento 2 (desde otro número)',
  E'{saludo} {nombre|}, te escribo desde este otro número porque cambié de línea. Seguía con el tema de captar más clientes por WhatsApp; si te sirve te puedo mandar un ejemplo corto. ¿Te lo envío?', 1),
 (4,'failover','Seguimiento 3 (desde otro número)',
  E'[[Hola|Buenas]] {nombre|}, te escribo desde este otro número porque cambié de línea. Este es mi último mensaje para no ser pesado; si más adelante quieres ver cómo automatizar tu atención por WhatsApp, aquí estoy. ¡Que te vaya muy bien!', 1);
