'use client';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ContractType } from '@/types/domain';

/** Step 1 (spec 04 §1) — required, no default. */
export function ContractTypeSelect({
  value,
  onChange,
  disabled,
}: {
  value: ContractType | null;
  onChange: (value: ContractType) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="contract-type">Contract type</Label>
      <Select
        value={value ?? undefined}
        onValueChange={(v) => onChange(v as ContractType)}
        disabled={disabled}
      >
        <SelectTrigger id="contract-type" aria-describedby="contract-type-help">
          <SelectValue placeholder="Choose a contract type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="NDA">NDA</SelectItem>
          <SelectItem value="MSA">MSA</SelectItem>
        </SelectContent>
      </Select>
      <p id="contract-type-help" className="text-caption text-grey-400">
        ContractIQ supports NDAs and MSAs in English under US or UK law.
      </p>
    </div>
  );
}
