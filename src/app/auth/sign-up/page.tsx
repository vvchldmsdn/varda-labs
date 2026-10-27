import { localizedMetadata } from "@/lib/i18n/server";
import { AuthEntry } from "@/components/auth/auth-entry";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return localizedMetadata({
  title: "회원가입 | CAIRN LABS",
  robots: { index: false, follow: false },
}, "Sign up | CAIRN LABS");
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const params = await searchParams;
  return <AuthEntry mode="sign-up" preview={params.preview === "design"} />;
}
