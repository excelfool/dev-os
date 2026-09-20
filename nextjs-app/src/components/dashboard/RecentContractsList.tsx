import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge, contractHref } from './StatusBadge';
import { formatDate } from '@/lib/utils/format';
import type { ContractStatus, ContractType } from '@/types/domain';

export interface RecentContract {
  id: string;
  file_name: string;
  contract_type: ContractType;
  status: ContractStatus;
  review_completed_at: string | null;
  created_at: string;
}

export function RecentContractsList({ contracts }: { contracts: RecentContract[] }) {
  return (
    <Card className="flex flex-col gap-subsection">
      <h2 className="text-h5 text-grey-900">Recent contracts</h2>
      <ul className="flex flex-col">
        {contracts.map((contract) => (
          <li key={contract.id} className="border-b border-grey-50 last:border-b-0">
            {/* A real link, so middle-click and keyboard activation both work. */}
            <Link
              href={contractHref(contract.id, contract.status)}
              className="flex flex-wrap items-center justify-between gap-3 rounded-btn px-2 py-3 hover:bg-grey-25"
            >
              <span className="min-w-0 flex-1 truncate text-body text-grey-900">
                {contract.file_name}
              </span>
              <span className="flex items-center gap-3">
                <Badge>{contract.contract_type}</Badge>
                <StatusBadge
                  status={contract.status}
                  reviewCompleted={Boolean(contract.review_completed_at)}
                />
                <span className="text-caption text-grey-400">
                  {formatDate(contract.created_at)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
