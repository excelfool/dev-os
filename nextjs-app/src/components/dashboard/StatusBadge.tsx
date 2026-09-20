import { Badge, type BadgeTone } from '@/components/ui/badge';
import type { ContractStatus } from '@/types/domain';

const STATUS_PRESENTATION: Record<ContractStatus, { label: string; tone: BadgeTone }> = {
  uploaded: { label: 'Not processed', tone: 'neutral' },
  processing: { label: 'Analysing…', tone: 'neutral' },
  completed: { label: 'Reviewed', tone: 'success' },
  error: { label: 'Failed', tone: 'danger' },
};

export function StatusBadge({
  status,
  reviewCompleted = false,
}: {
  status: ContractStatus;
  reviewCompleted?: boolean;
}) {
  const presentation = STATUS_PRESENTATION[status];
  const label =
    status === 'completed' && reviewCompleted ? 'Review complete' : presentation.label;

  return <Badge tone={presentation.tone}>{label}</Badge>;
}

/** A contract that has not been processed opens at its prepare screen. */
export function contractHref(id: string, status: ContractStatus): string {
  return status === 'uploaded' ? `/contracts/${id}/prepare` : `/contracts/${id}`;
}
