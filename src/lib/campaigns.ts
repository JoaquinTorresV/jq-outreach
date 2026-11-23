export const CAMPAIGNS = ['web_sales', 'whatsapp_automation'] as const;
export type Campaign = (typeof CAMPAIGNS)[number];

export const CAMPAIGN_LABEL: Record<Campaign, string> = {
  web_sales: 'Venta de páginas web',
  whatsapp_automation: 'Automatización de WhatsApp',
};

export function parseCampaign(value: unknown): Campaign {
  if (typeof value === 'string' && CAMPAIGNS.includes(value as Campaign)) return value as Campaign;
  throw new Error('Campaña inválida');
}
