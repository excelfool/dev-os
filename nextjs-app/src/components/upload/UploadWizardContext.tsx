'use client';

import { createContext, useContext, useMemo, useReducer } from 'react';
import type { ContractType } from '@/types/domain';

/**
 * Upload wizard state (spec 04 §5). Deliberately a local useReducer Context,
 * not global state — nothing outside the wizard reads it.
 */
interface WizardState {
  contractType: ContractType | null;
  file: File | null;
  clientError: string | null;
  serverError: string | null;
  deviceAdvisory: boolean;
}

type WizardAction =
  | { type: 'set_contract_type'; contractType: ContractType }
  | { type: 'set_file'; file: File; deviceAdvisory: boolean }
  | { type: 'client_error'; message: string }
  | { type: 'server_error'; message: string }
  | { type: 'clear_file' };

const initialState: WizardState = {
  contractType: null,
  file: null,
  clientError: null,
  serverError: null,
  deviceAdvisory: false,
};

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'set_contract_type':
      return { ...state, contractType: action.contractType, serverError: null };
    case 'set_file':
      return {
        ...state,
        file: action.file,
        clientError: null,
        serverError: null,
        deviceAdvisory: action.deviceAdvisory,
      };
    case 'client_error':
      return { ...state, file: null, clientError: action.message, serverError: null };
    case 'server_error':
      // The contract type selection is preserved so the user can retry
      // immediately; the file is cleared.
      return { ...state, file: null, serverError: action.message, clientError: null };
    case 'clear_file':
      return { ...state, file: null, clientError: null, serverError: null, deviceAdvisory: false };
  }
}

const WizardContext = createContext<{
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
} | null>(null);

export function UploadWizardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useUploadWizard() {
  const context = useContext(WizardContext);
  if (!context) throw new Error('useUploadWizard must be used inside UploadWizardProvider');
  return context;
}
