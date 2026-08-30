import { AuthEntry } from "@/components/auth/auth-entry";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "로그인 | VARDA-LABS",
  robots: { index: false, follow: false },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string; verified?: string; error?: string }>;
}) {
  const params = await searchParams;
  return <AuthEntry mode="sign-in" preview={params.preview === "design"} verified={params.verified === "1" && !params.error} callbackError={Boolean(params.error)} />;
}
