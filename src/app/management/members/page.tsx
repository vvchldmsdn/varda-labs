import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isActivityAdmin } from "@/lib/auth/member-activity-identity";
import { getMemberActivityReport } from "@/db/queries/member-activity";
import { MemberActivityView } from "@/components/member-activity-view";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "회원 활동 | CAIRN LABS", robots: { index: false, follow: false } };
export default async function MembersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  if (!(await isActivityAdmin())) notFound();
  const params = await searchParams;
  let report;
  try { report = await getMemberActivityReport(Number(params.page) || 1); }
  catch { return <main className="mx-auto max-w-3xl p-8"><h1>회원 활동</h1><p role="alert">활동 기록을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.</p><Link href="/management/members">다시 확인</Link></main>; }
  if (!report) notFound();
  return <MemberActivityView report={report} />;
}
