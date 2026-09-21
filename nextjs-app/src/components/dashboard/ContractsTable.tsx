'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Trash2, RotateCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge, contractHref } from './StatusBadge';
import { DeleteContractDialog } from './DeleteContractDialog';
import { useDashboardToast } from './dashboard-toast';
import { formatDate } from '@/lib/utils/format';
import type { ContractStatus, ContractType } from '@/types/domain';

interface Row {
  id: string;
  file_name: string;
  contract_type: ContractType;
  status: ContractStatus;
  page_count: number;
  created_at: string;
  review_completed_at: string | null;
}

interface ListResponse {
  contracts: Row[];
  page: number;
  page_size: number;
  total: number;
}

type SortColumn = 'file_name' | 'contract_type' | 'created_at';

const COLUMNS: Array<{ key: SortColumn | null; label: string }> = [
  { key: 'file_name', label: 'File name' },
  { key: 'contract_type', label: 'Type' },
  { key: null, label: 'Status' },
  { key: 'created_at', label: 'Uploaded' },
  { key: null, label: 'Pages' },
  { key: null, label: '' },
];

export function ContractsTable() {
  const router = useRouter();
  const { show: showToast } = useDashboardToast();
  const [pendingRemoval, setPendingRemoval] = useState<string[]>([]);
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const sort = (params.get('sort') as SortColumn) ?? 'created_at';
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';
  const page = Number(params.get('page') ?? '1');
  const typeFilter = params.get('type') ?? '';
  const statusFilter = params.get('status') ?? '';

  const search = new URLSearchParams({ sort, order, page: String(page) });
  if (typeFilter) search.set('type', typeFilter);
  if (statusFilter) search.set('status', statusFilter);

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ['contracts', search.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/contracts?${search.toString()}`);
      if (!res.ok) throw new Error('list failed');
      return res.json();
    },
  });

  // Sort state lives in the URL, so a sorted view is shareable and survives a
  // refresh (spec 09 §2).
  function toggleSort(column: SortColumn) {
    const next = new URLSearchParams(params.toString());
    next.set('sort', column);
    next.set('order', sort === column && order === 'desc' ? 'asc' : 'desc');
    next.set('page', '1');
    router.replace(`/dashboard?${next.toString()}`);
  }

  function setFilter(key: 'type' | 'status', value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set('page', '1');
    router.replace(`/dashboard?${next.toString()}`);
  }

  /**
   * Spec 11 §5 step 5: optimistic removal with rollback on failure, and a
   * confirmation toast. The toast is NOT local state: deleting the last
   * contract unmounts this component on the next refresh (the page switches
   * to its empty state), so a local toast died with it. See dashboard-toast.
   */
  async function remove(id: string) {
    setPendingRemoval((prev) => [...prev, id]);
    try {
      const res = await fetch(`/api/contracts/${id}`, { method: 'DELETE' });
      if (res.ok || res.status === 404) {
        await queryClient.invalidateQueries({ queryKey: ['contracts'] });
        router.refresh();
        showToast('Contract and all associated data deleted.');
        return;
      }
      // Rollback: the row comes back rather than vanishing on a failed delete.
      setPendingRemoval((prev) => prev.filter((pending) => pending !== id));
    } catch {
      setPendingRemoval((prev) => prev.filter((pending) => pending !== id));
    }
  }

  async function retry(id: string) {
    await fetch(`/api/contracts/${id}/process`, { method: 'POST' });
    await queryClient.invalidateQueries({ queryKey: ['contracts'] });
    router.refresh();
  }

  const rows = (data?.contracts ?? []).filter((row) => !pendingRemoval.includes(row.id));
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * (data?.page_size ?? 50) + 1;
  const to = Math.min(page * (data?.page_size ?? 50), total);

  return (
    <section className="flex flex-col gap-subsection" aria-label="All contracts">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h5 text-grey-900">All contracts</h2>
        <div className="flex items-center gap-2">
          <select
            aria-label="Filter by type"
            value={typeFilter}
            onChange={(e) => setFilter('type', e.target.value)}
            className="rounded-input border border-grey-200 px-2 py-1.5 text-caption text-grey-900"
          >
            <option value="">All types</option>
            <option value="NDA">NDA</option>
            <option value="MSA">MSA</option>
          </select>
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setFilter('status', e.target.value)}
            className="rounded-input border border-grey-200 px-2 py-1.5 text-caption text-grey-900"
          >
            <option value="">All statuses</option>
            <option value="uploaded">Not processed</option>
            <option value="processing">Analysing</option>
            <option value="completed">Reviewed</option>
            <option value="error">Failed</option>
          </select>
        </div>
      </div>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-grey-100">
            {COLUMNS.map(({ key, label }) => (
              <th
                key={label || 'actions'}
                scope="col"
                aria-sort={key && sort === key ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="py-2 text-caption font-normal text-grey-400"
              >
                {key ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(key)}
                    className="inline-flex items-center gap-1 hover:text-grey-900"
                  >
                    {label}
                    {sort === key &&
                      (order === 'asc' ? (
                        <ArrowUp aria-hidden="true" className="h-3 w-3" />
                      ) : (
                        <ArrowDown aria-hidden="true" className="h-3 w-3" />
                      ))}
                  </button>
                ) : (
                  label
                )}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {isLoading &&
            Array.from({ length: 3 }, (_, i) => (
              <tr key={i} className="border-b border-grey-50">
                <td colSpan={6} className="py-3">
                  <div className="h-4 w-full animate-pulse rounded bg-grey-50" />
                </td>
              </tr>
            ))}

          {!isLoading &&
            rows.map((row) => (
              <tr key={row.id} className="border-b border-grey-50">
                <td className="py-3">
                  <Link
                    href={contractHref(row.id, row.status)}
                    className="text-body text-grey-900 hover:underline"
                  >
                    {row.file_name}
                  </Link>
                </td>
                <td className="py-3">
                  <Badge>{row.contract_type}</Badge>
                </td>
                <td className="py-3">
                  <StatusBadge
                    status={row.status}
                    reviewCompleted={Boolean(row.review_completed_at)}
                  />
                </td>
                <td className="py-3 text-caption text-grey-500">{formatDate(row.created_at)}</td>
                <td className="py-3 text-caption text-grey-500">{row.page_count}</td>
                <td className="py-3">
                  <div className="flex items-center justify-end gap-1">
                    {row.status === 'error' && (
                      <Button variant="ghost" size="sm" onClick={() => void retry(row.id)}>
                        <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
                        Retry
                      </Button>
                    )}
                    <DeleteContractDialog
                      fileName={row.file_name}
                      onConfirm={() => remove(row.id)}
                      trigger={
                        <Button variant="ghost" size="sm" aria-label={`Delete ${row.file_name}`}>
                          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                        </Button>
                      }
                    />
                  </div>
                </td>
              </tr>
            ))}

          {!isLoading && rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-8 text-center text-body text-grey-400">
                No contracts match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {total > 0 && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-caption text-grey-400">
            Showing {from}–{to} of {total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                const next = new URLSearchParams(params.toString());
                next.set('page', String(page - 1));
                router.replace(`/dashboard?${next.toString()}`);
              }}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={to >= total}
              onClick={() => {
                const next = new URLSearchParams(params.toString());
                next.set('page', String(page + 1));
                router.replace(`/dashboard?${next.toString()}`);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
