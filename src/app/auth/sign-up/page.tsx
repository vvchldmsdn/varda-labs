import { AuthEntry } from "@/components/auth/auth-entry";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "회원가입 | VARDA-LABS",
  robots: { index: false, follow: false },
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const params = await searchParams;
  return <AuthEntry mode="sign-up" preview={params.preview === "design"} />;
}
