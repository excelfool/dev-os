// Supabase Edge Function (Deno). Outbound email for the two obligations in the
// sources: the account-deletion confirmation (spec 11 §3) and the P0 incident
// email (PRD §11). One function, the project's own SMTP, no new paid vendor.
//
// Emails never contain contract content, term values or chat text.
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const BATCH_SIZE = 50;

interface NotificationRequest {
  template: 'account_deleted' | 'incident_p0';
  to: string[];
  vars: Record<string, string>;
}

function render(template: NotificationRequest['template'], vars: Record<string, string>) {
  if (template === 'account_deleted') {
    return {
      subject: 'Your ContractIQ account has been deleted',
      body:
        'Your ContractIQ account and all associated data have been permanently deleted. ' +
        'Nothing further is required from you.',
    };
  }

  const statusPage = vars.status_page_url ?? '';
  return {
    subject: 'ContractIQ service incident',
    body: [vars.message ?? 'We are investigating a service incident.', statusPage]
      .filter(Boolean)
      .join('\n\n'),
  };
}

Deno.serve(async (req: Request) => {
  const auth = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (auth !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const request = (await req.json()) as NotificationRequest;
  const { subject, body } = render(request.template, request.vars ?? {});

  const host = Deno.env.get('SMTP_HOST');
  const from = Deno.env.get('SMTP_FROM') ?? 'ContractIQ <no-reply@contractiq.app>';

  // SMTP is not configured in every environment. Report the shortfall rather
  // than throwing: every caller treats sending as best effort.
  if (!host) {
    console.warn(JSON.stringify({ job: 'send-notification', skipped: 'SMTP_HOST unset' }));
    return new Response(JSON.stringify({ sent: 0, failed: request.to.length }), { status: 200 });
  }

  const client = new SMTPClient({
    connection: {
      hostname: host,
      port: Number(Deno.env.get('SMTP_PORT') ?? '587'),
      tls: Deno.env.get('SMTP_PORT') === '465',
      auth: {
        username: Deno.env.get('SMTP_USER')!,
        password: Deno.env.get('SMTP_PASSWORD')!,
      },
    },
  });

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < request.to.length; i += BATCH_SIZE) {
    const batch = request.to.slice(i, i + BATCH_SIZE);
    for (const recipient of batch) {
      try {
        await client.send({ from, to: recipient, subject, content: body });
        sent += 1;
      } catch (err) {
        // A batch failure is reported, never thrown.
        failed += 1;
        console.warn(JSON.stringify({ job: 'send-notification', recipientFailed: true, reason: String(err) }));
      }
    }
  }

  await client.close();

  console.log(JSON.stringify({ job: 'send-notification', template: request.template, sent, failed }));
  return new Response(JSON.stringify({ sent, failed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
