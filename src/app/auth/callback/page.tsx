import { redirect } from "next/navigation";

import { AUTH_TRANSPORT_SESSION_PATH } from "@/lib/auth/auth-transport-routes";

export const dynamic = "force-dynamic";

export default function AuthCallbackPage() {
  redirect(AUTH_TRANSPORT_SESSION_PATH);
}
