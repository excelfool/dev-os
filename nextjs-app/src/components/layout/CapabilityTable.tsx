import { CheckCircle2, CircleDashed, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CAPABILITIES, limitationsCopy, type Capability, type CapabilityKey } from '@/lib/capabilities';
import { publicConfig } from '@/lib/utils/config';

/**
 * "What ContractIQ can do today" (spec 21 §3, PRD Flow 2 step 3, P-1).
 * Read-only; one row per `owner='product'` entry, fixed group order.
 */
const GROUPS: Array<{ title: string; keys: CapabilityKey[] }> = [
  {
    title: 'Upload & import',
    keys: ['ingest.pdf_text', 'ingest.docx', 'ingest.ocr', 'import.drive', 'import.dropbox', 'import.sharepoint', 'versioning.duplicate_detect'],
  },
  { title: 'Analysis', keys: ['classify.contract_type', 'extract.key_terms', 'extract.summary'] },
  {
    title: 'Chat & retrieval',
    keys: ['qa.single_contract', 'qa.cross_contract', 'retrieval.full_context', 'retrieval.query_enhancer', 'retrieval.vector', 'retrieval.graph', 'retrieval.n8n', 'compare.contracts'],
  },
  { title: 'Risk & playbooks', keys: ['playbook.manage', 'risk.flag', 'risk.escalate', 'redline.word'] },
  { title: 'Integrations', keys: ['crm.hubspot', 'crm.salesforce', 'esign.docusign'] },
  { title: 'Reminders & export', keys: ['reminders.key_dates', 'export.csv_pdf'] },
  { title: 'Billing', keys: ['billing'] },
];

function StatusPill({ status }: { status: Capability['status'] }) {
  if (status === 'built') {
    return (
      <Badge tone="success">
        <CheckCircle2 aria-hidden="true" className="h-3 w-3" /> Available now
      </Badge>
    );
  }
  if (status === 'stub') {
    return (
      <Badge tone="warning">
        <Clock aria-hidden="true" className="h-3 w-3" /> In progress
      </Badge>
    );
  }
  return (
    <Badge tone="neutral">
      <CircleDashed aria-hidden="true" className="h-3 w-3" /> Planned
    </Badge>
  );
}

function availability(c: Capability): { status: Capability['status']; text: string; note: string } {
  // The export kill-switch: the table never claims a feature the UI hides.
  if (c.key === 'export.csv_pdf' && !publicConfig.exportEnabled) {
    return {
      status: 'stub',
      text: 'In progress · v1.1',
      note: 'Export is built and switched on per environment',
    };
  }
  return {
    status: c.status,
    text: c.status === 'built' && c.phase === '—' ? 'Now' : c.status === 'built' ? 'Now' : c.phase,
    note: c.user_note,
  };
}

export function CapabilityTable() {
  return (
    <section id="capabilities" className="flex flex-col gap-subsection">
      <h2 className="text-h3 text-grey-900">What ContractIQ can do today</h2>
      <p className="text-body text-grey-500">
        ContractIQ is honest about what it does and doesn&apos;t do yet. This list is generated from
        the same registry the software runs on.
      </p>
      <p className="text-caption text-grey-600">{limitationsCopy()}</p>

      <table className="w-full text-left text-caption">
        <caption className="sr-only">Capabilities and their availability</caption>
        <thead>
          <tr className="border-b border-grey-100 text-grey-500">
            <th scope="col" className="py-2 pr-2 font-medium">Capability</th>
            <th scope="col" className="py-2 pr-2 font-medium">Status</th>
            <th scope="col" className="py-2 pr-2 font-medium">Available</th>
            <th scope="col" className="py-2 font-medium">Note</th>
          </tr>
        </thead>
        {GROUPS.map((group) => (
          <tbody key={group.title}>
            <tr>
              <th scope="colgroup" colSpan={4} className="pt-4 pb-1 text-grey-400">
                {group.title}
              </th>
            </tr>
            {group.keys
              .map((key) => CAPABILITIES[key])
              .filter((c) => c.owner === 'product')
              .map((c) => {
                const a = availability(c);
                return (
                  <tr key={c.key} data-capability={c.key} className="border-b border-grey-50 align-top">
                    <th scope="row" className="py-2 pr-2 font-normal text-grey-900">
                      {c.label}
                    </th>
                    <td className="py-2 pr-2">
                      <StatusPill status={a.status} />
                    </td>
                    <td className="py-2 pr-2 text-grey-700">{a.text}</td>
                    <td className="py-2 text-grey-500">{a.note}</td>
                  </tr>
                );
              })}
          </tbody>
        ))}
      </table>
    </section>
  );
}
