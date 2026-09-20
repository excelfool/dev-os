import 'server-only';
import { getServerConfig } from '@/lib/utils/server-config';
import { publicConfig } from '@/lib/utils/config';

/**
 * Invokes the `send-notification` Edge Function (spec 14 §2a).
 *
 * Both outbound-email obligations go through one function so no paid vendor is
 * added beyond Supabase, OpenAI and Uptime Robot.
 */
export type NotificationTemplate = 'account_deleted' | 'incident_p0';

export interface NotificationRequest {
  template: NotificationTemplate;
  to: string[];
  vars: Record<string, string>;
}

export async function sendNotification(request: NotificationRequest): Promise<void> {
  const cfg = getServerConfig();

  const res = await fetch(`${publicConfig.supabaseUrl}/functions/v1/send-notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(request),
  });

  if (!res.ok) throw new Error(`send-notification returned ${res.status}`);
}
