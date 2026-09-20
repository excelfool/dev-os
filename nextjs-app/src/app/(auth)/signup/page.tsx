import { AuthCard } from '@/components/auth/AuthCard';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata = { title: 'Create your account · ContractIQ' };

export default function SignUpPage() {
  return (
    <AuthCard
      title="Create your account"
      subtitle="Start reviewing NDAs and MSAs in minutes. No card required."
      footerPrompt="Already have an account?"
      footerLinkHref="/login"
      footerLinkLabel="Sign in"
    >
      <AuthForm mode="signup" />
    </AuthCard>
  );
}
