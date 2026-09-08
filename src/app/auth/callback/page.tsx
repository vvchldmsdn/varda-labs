import { localizedMetadata } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { AUTH_TRANSPORT_SESSION_PATH } from "@/lib/auth/auth-transport-routes";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return localizedMetadata({ title: "로그인 연결 | VARDA LABS" }, "Sign-in connection | VARDA LABS");
}

export default function AuthCallbackPage() {
  redirect(AUTH_TRANSPORT_SESSION_PATH);
}
