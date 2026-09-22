/**
 * Hand-written domain types used across layers (spec 01 §6).
 */

export type ContractType = 'NDA' | 'MSA';
export type DetectedType = ContractType | 'OTHER';
export type ContractStatus = 'uploaded' | 'processing' | 'completed' | 'error';
export type Plan = 'free_trial' | 'starter' | 'growth' | 'pro';
export type QueryClass = 'contract' | 'history' | 'both';
export type ConfidenceBand = 'high' | 'medium' | 'low';
export type Rating = 'up' | 'down';
export type SurveyAccuracy = 'yes' | 'partially' | 'no';
export type IncidentLevel = 'none' | 'p1' | 'p0';

export interface Profile {
  id: string;
  email: string;
  plan: Plan;
  trial_ends_at: string | null;
  feedback_opt_in: boolean;
  analyses_used: number;
  quota_period_start: string;
  created_at: string;
}

export interface Contract {
  id: string;
  user_id: string;
  file_name: string;
  contract_type: ContractType;
  detected_type: DetectedType | null;
  type_mismatch_warning: boolean;
  file_path: string | null;
  file_size_bytes: number;
  page_count: number;
  token_estimate: number;
  contract_text: string;
  status: ContractStatus;
  error_code: string | null;
  error_message: string | null;
  first_term_ready_ms: number | null;
  processing_started_at: string | null;
  processed_at: string | null;
  review_completed_at: string | null;
  last_accessed_at: string;
  pdf_purged_at: string | null;
  prompt_version: string;
  created_at: string;
  updated_at: string;
  /** v1.1: OCR confidence 0–100 when the text came from OCR (spec 06 v1.1 §D). */
  ocr_confidence?: number | null;
  content_hash?: string | null;
  /** v1.1 summary (US-015, spec 06 v1.1 §B). */
  summary_md?: string | null;
  summary_status?: SummaryStatus;
  summary_uncited?: boolean;
  summary_generated_ms?: number | null;
  summary_claimed_at?: string | null;
  /** Derived by GET /api/contracts/{id}: processing and claimed > 2 min ago. */
  summary_claim_stale?: boolean;
  term_library_version?: string;
}

export type SummaryStatus = 'none' | 'pending' | 'processing' | 'completed' | 'error';

export type KeyDateKind = 'end_date' | 'renewal_notice_deadline' | 'renewal_date' | 'auto_renewal_check';

export interface KeyDate {
  id: string;
  kind: KeyDateKind;
  date: string;
  term_id: string | null;
  term_name: string | null;
  is_manual: boolean;
  /** D52: the source values, so the card can roll a stale renewal forward. */
  derived_from?: Record<string, unknown> | null;
  reminders: Array<{ id: string; offset_days: number; send_at: string; status: string; channel: string }>;
}

export interface KeyTerm {
  id: string;
  contract_id: string;
  user_id: string;
  term_name: string;
  /** NULL means the model searched and did not find it — "Not found in document". */
  value: string | null;
  page_number: number | null;
  /** Integer 0–100. The model's 0.0–1.0 is converted once, in extraction-service. */
  confidence_score: number;
  source_sentence: string | null;
  is_source_verified: boolean;
  is_custom: boolean;
  display_rank: number;
  original_ai_value: string | null;
  is_edited: boolean;
  edited_at: string | null;
  created_at: string;
  /** v1.1 (spec 06 v1.1 §A). Optional until the v1.1 schema additions are applied. */
  reasoning?: string | null;
  original_ai_page?: number | null;
  original_ai_reasoning?: string | null;
  is_required?: boolean;
  page_edited?: boolean;
  reasoning_edited?: boolean;
}

export interface CustomTerm {
  id: string;
  contract_id: string;
  term_name: string;
  is_manual: boolean;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  cited_pages: number[] | null;
  citation_verified: boolean;
  query_class: QueryClass | null;
  latency_ms: number | null;
  created_at: string;
}

export interface QuotaState {
  plan: Plan;
  used: number;
  /** 0 means blocked (expired trial); null means unlimited (pro). */
  limit: number | null;
  remaining: number | null;
  resetsAt: string | null;
}
