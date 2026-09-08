import { redirect } from "next/navigation";

import { AUTH_TRANSPORT_SESSION_PATH } from "@/lib/auth/auth-transport-routes";

export const dynamic = "force-dynamic";

export const metadata = { title: "로그인 연결 | VARDA LABS" };

export default function AuthCallbackPage() {
  redirect(AUTH_TRANSPORT_SESSION_PATH);
}
