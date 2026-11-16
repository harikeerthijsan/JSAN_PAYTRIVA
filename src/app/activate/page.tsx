import { AuthCard } from "@/components/auth-card";
import { ActivationForm } from "@/components/activation-form";

export default function ActivatePage() {
  return (
    <AuthCard
      eyebrow="ACCOUNT ACTIVATION"
      title="Make it yours."
      description="Set a secure password to activate your PAYTRIVA account."
    >
      <ActivationForm />
    </AuthCard>
  );
}
