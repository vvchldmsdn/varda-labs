import { AuthRecovery } from "@/components/auth/auth-recovery";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "비밀번호 찾기 | VARDA-LABS",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

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
