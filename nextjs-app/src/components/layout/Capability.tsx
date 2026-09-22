'use client';

import { getCapability } from '@/lib/capabilities';
import type { CapabilityKey } from '@/lib/capabilities';

/**
 * The one implementation of "hidden, not absent" (spec 21 §1.4, P-6).
 *
 * `built` renders the children. `planned` renders nothing at all — the feature
 * does not exist yet and must not hint that it does. `stub` depends on how
 * much of the feature is real: the default shows `fallback` (an empty state),
 * while `stub="children"` renders the children plus `stubNote`, for a
 * capability whose data layer is already live and only whose downstream is
 * missing — `KeyDatesCard` (§7.4) and Review mode (spec 22 §4, D53).
 */
export function Capability({
  capability,
  stub = 'fallback',
  stubNote,
  fallback = null,
  children,
}: {
  /** Not named `key`: React reserves that prop and would never pass it on. */
  capability: CapabilityKey;
  stub?: 'fallback' | 'children';
  stubNote?: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { status } = getCapability(capability);

  if (status === 'planned') return null;
  if (status === 'built') return <>{children}</>;

  if (stub === 'children') {
    return (
      <>
        {children}
        {stubNote && <p className="text-caption text-grey-400">{stubNote}</p>}
      </>
    );
  }
  return <>{fallback}</>;
}
