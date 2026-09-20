'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { recordEvent } from '@/lib/metrics/events';
import { credentialsSchema, signInSchema, safeNextPath } from './auth-validation';
import { FieldError } from './FieldError';

type Mode = 'signup' | 'login';

interface FieldErrors {
  email?: string;
  password?: string;
  form?: string;
}

const RESEND_COOLDOWN_SECONDS = 60;

export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  /**
   * A field is "touched" once the user has typed in it or left it. Validation
   * messages appear from that point, NOT only after a submit.
   *
   * Without this, the form is a silent dead end: `disabled` is driven by the
   * schema, but the error state was only written inside handleSubmit — which
   * the disabled button prevents from ever running. The user saw a button that
   * would not enable and no statement of which rule was unmet, and `aria-invalid`
   * stayed false, so assistive tech had nothing either (WCAG 3.3.1).
   */
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({
    email: false,
    password: false,
  });
  const [isPending, setIsPending] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const schema = mode === 'signup' ? credentialsSchema : signInSchema;
  const parsed = schema.safeParse({ email, password });
  const isValid = parsed.success;

  // Live validation messages, shown per field once that field is touched.
  const liveErrors: FieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'email' && touched.email && !liveErrors.email) liveErrors.email = issue.message;
      if (field === 'password' && touched.password && !liveErrors.password) {
        liveErrors.password = issue.message;
      }
    }
  }

  // A server response outranks a live message for the same field — but only
  // when it is actually set. A spread would let an explicit `undefined` (how a
  // server error is cleared on the next keystroke) overwrite a live message.
  const errors: FieldErrors = {
    email: serverErrors.email ?? liveErrors.email,
    password: serverErrors.password ?? liveErrors.password,
    form: serverErrors.form,
  };

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isValid || isPending) return;

    setIsPending(true);
    setServerErrors({});
    const startedAt = Date.now();

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });

        if (error) {
          setServerErrors(mapSignUpError(error.message));
          return;
        }

        // The authoritative signal is whether a session came back — never the
        // feature flag alone (spec 03 §1).
        if (data.session) {
          await recordCompletion(startedAt);
          router.replace('/dashboard');
          router.refresh();
        } else {
          setAwaitingConfirmation(true);
          setResendCooldown(RESEND_COOLDOWN_SECONDS);
        }
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setServerErrors(mapSignInError(error.message));
        return;
      }

      await recordCompletion(startedAt);
      router.replace(safeNextPath(next));
      router.refresh();
    } catch {
      setServerErrors({ form: "We couldn't reach the server. Please try again." });
    } finally {
      setIsPending(false);
    }
  }

  async function recordCompletion(startedAt: number) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    // Evidence for the ≤10s auth target (spec 03 §12).
    await recordEvent(supabase, {
      userId: user.id,
      eventType: 'auth_complete',
      durationMs: Date.now() - startedAt,
    });
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    await supabase.auth.signUp({ email, password });
  }

  if (awaitingConfirmation) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <p className="text-body text-grey-900">Check your inbox to verify your email</p>
        <p className="text-body text-grey-500">
          We sent a verification link to <span className="text-grey-900">{email}</span>. Open it to
          finish setting up your account.
        </p>
        <Button variant="secondary" onClick={handleResend} disabled={resendCooldown > 0}>
          {resendCooldown > 0 ? `Resend email in ${resendCooldown}s` : 'Resend email'}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setTouched((t) => ({ ...t, email: true }));
            setServerErrors((prev) => ({ ...prev, email: undefined, form: undefined }));
          }}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
        <FieldError id="email-error" message={errors.email} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setTouched((t) => ({ ...t, password: true }));
            setServerErrors((prev) => ({ ...prev, password: undefined, form: undefined }));
          }}
          onBlur={() => setTouched((t) => ({ ...t, password: true }))}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? 'password-error' : undefined}
        />
        <FieldError id="password-error" message={errors.password} />
        {mode === 'signup' && !errors.password && (
          <p className="text-caption text-grey-400">
            At least 8 characters, including a letter and a number.
          </p>
        )}
      </div>

      {errors.form && (
        <p role="alert" className="text-caption text-danger-700">
          {errors.form}{' '}
          {errors.form.includes('already registered') && (
            <Link href="/login" className="underline">
              Sign in
            </Link>
          )}
        </p>
      )}

      {/* A disabled button is not focusable, so the reason it is disabled has
          to be stated in the form itself. */}
      {!isValid && (touched.email || touched.password) && (
        <p aria-live="polite" className="text-caption text-grey-400">
          {mode === 'signup'
            ? 'Enter a valid email address and a password of at least 8 characters including a letter and a number.'
            : 'Enter your email address and password to continue.'}
        </p>
      )}

      <Button type="submit" size="lg" disabled={!isValid || isPending}>
        {isPending
          ? mode === 'signup'
            ? 'Creating your account…'
            : 'Signing you in…'
          : mode === 'signup'
            ? 'Create account'
            : 'Sign in'}
      </Button>
    </form>
  );
}

function mapSignUpError(message: string): FieldErrors {
  const lower = message.toLowerCase();
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return { form: 'That email is already registered — try signing in instead.' };
  }
  if (lower.includes('password')) {
    return { password: 'Use at least 8 characters, including a letter and a number.' };
  }
  return { form: "We couldn't create your account. Please try again." };
}

function mapSignInError(message: string): FieldErrors {
  const lower = message.toLowerCase();
  if (lower.includes('rate') || lower.includes('too many')) {
    return { form: 'Too many attempts. Try again in a few minutes.' };
  }
  // Never disclose which field was wrong.
  return { form: 'Email or password is incorrect.' };
}
