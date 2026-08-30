import { AuthRecovery } from "@/components/auth/auth-recovery";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "이메일 인증 | VARDA-LABS",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthRecovery mode="verify-email" preview={params.preview === "design"} />
  );
}
