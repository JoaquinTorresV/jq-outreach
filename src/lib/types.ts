import type { Campaign } from './campaigns';

export type AccountRow = {
  id: number; label: string; phone: string | null; status: string; status_reason: string | null; connection: string;
  paused_until: string | null; simulated: boolean; first_message_mode: 'manual' | 'auto';
  daily_new_cap: number; daily_total_cap: number; hourly_cap: number; proxy_url: string | null;
  qr: string | null; qr_at: string | null; pairing_code: string | null; wa_jid: string | null;
  cap_info: Record<string, unknown> | null; consecutive_failures: number; last_error: string | null;
  last_heartbeat: string | null; last_connected_at: string | null; disconnected_since: string | null;
  last_sent_at: string | null; created_at: string;
};

export type ContactRow = {
  id: number; phone: string; jid: string | null; lid: string | null; name: string | null; first_name: string | null;
  business_name: string | null; address: string | null; city: string | null; category: string | null;
  email: string | null; instagram: string | null; facebook: string | null; website: string | null; maps_url: string | null; campaign: Campaign;
  extra: Record<string, unknown>; batch_id: number | null; source: string; account_id: number | null;
  stage: string; stage_reason: string | null; step: number; next_action_at: string | null;
  verify_attempts: number; verified_at: string | null; failover_pending: boolean;
  first_sent_at: string | null; last_outbound_at: string | null; last_inbound_at: string | null;
  notes: string | null; created_at: string; updated_at: string;
};

export type MessageRow = {
  id: number; contact_id: number; account_id: number | null; direction: 'out' | 'in'; step: number | null;
  source: string; body: string | null; body_hash: string | null; template_id: number | null; status: string;
  attempts: number; retry_at: string | null; error_code: string | null; error_detail: string | null;
  wa_message_id: string | null; dry_run: boolean; created_at: string; sent_at: string | null; updated_at: string;
};
