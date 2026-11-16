import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "@/components/login-form";

export default function Home() {
  return (
    <AuthCard
      eyebrow="WELCOME BACK"
      title="Your financial workspace."
      description="Sign in with your JSAN employee account to continue."
      variant="login"
    >
      <LoginForm />
    </AuthCard>
  );
}
