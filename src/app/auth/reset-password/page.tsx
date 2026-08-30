import { AuthRecovery } from "@/components/auth/auth-recovery";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "비밀번호 재설정 | VARDA-LABS",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string; token?: string }>;
}) {
  const params = await searchParams;
  const token =
    typeof params.token === "string" &&
    /^[A-Za-z0-9._~-]{16,512}$/.test(params.token)
      ? params.token
      : "";
  return (
    <AuthRecovery
      mode="reset-password"
      preview={params.preview === "design"}
      resetToken={token}
    />
  );
}
