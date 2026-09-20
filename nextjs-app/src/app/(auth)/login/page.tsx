import { AuthCard } from '@/components/auth/AuthCard';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata = { title: 'Sign in · ContractIQ' };

const CALLBACK_ERRORS: Record<string, string> = {
  verification_failed:
    'That verification link is invalid or has expired — try signing in or requesting a new link.',
  missing_code: 'That verification link is incomplete — try signing in instead.',
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string };
}) {
  const calloutError = searchParams.error ? CALLBACK_ERRORS[searchParams.error] : undefined;

  return (
    <AuthCard
      title="Sign in"
      subtitle="Pick up where you left off."
      footerPrompt="New to ContractIQ?"
      footerLinkHref="/signup"
      footerLinkLabel="Create an account"
    >
      {calloutError && (
        <p role="alert" className="rounded-btn bg-danger-50 p-3 text-caption text-danger-700">
          {calloutError}
        </p>
      )}
      <AuthForm mode="login" next={searchParams.next} />
    </AuthCard>
  );
}
