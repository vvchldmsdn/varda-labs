import { localizedMetadata } from "@/lib/i18n/server";
import { AuthRecovery } from "@/components/auth/auth-recovery";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return localizedMetadata({
  title: "비밀번호 찾기 | VARDA-LABS",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
}, "Forgot password | VARDA LABS");
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthRecovery
      mode="forgot-password"
      preview={params.preview === "design"}
    />
  );
}
