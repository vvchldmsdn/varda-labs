import { localizedMetadata } from "@/lib/i18n/server";
import { AuthEntry } from "@/components/auth/auth-entry";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return localizedMetadata({
  title: "로그인 | VARDA-LABS",
  robots: { index: false, follow: false },
}, "Sign in | VARDA LABS");
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string; verified?: string; error?: string }>;
}) {
  const params = await searchParams;
  return <AuthEntry mode="sign-in" preview={params.preview === "design"} verified={params.verified === "1" && !params.error} callbackError={Boolean(params.error)} />;
}
