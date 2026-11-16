import { AuthCard } from "@/components/auth-card";
import { ActivationForm } from "@/components/activation-form";

export default function ResetPasswordPage() {
  return (
    <AuthCard
      eyebrow="ACCOUNT RECOVERY"
      title="Choose a new password."
      description="Set a new password for your PAYTRIVA account."
    >
      <ActivationForm reset />
    </AuthCard>
  );
}
