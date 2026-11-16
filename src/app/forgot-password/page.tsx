import { AuthCard } from "@/components/auth-card";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      eyebrow="ACCOUNT RECOVERY"
      title="Reset your password."
      description="Enter your JSAN work email and we’ll send a secure reset link if an active account exists."
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
