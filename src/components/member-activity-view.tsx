import Link from "next/link";
import { ACTIVITY_FEATURES, type ActivityFeature } from "@/lib/member-activity";
import type { MemberActivityReport } from "@/db/queries/member-activity";
import styles from "./member-activity.module.css";
const integer = new Intl.NumberFormat("ko-KR");
const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
export function MemberActivityView({ report }: { report: MemberActivityReport }) {
  return <main className={styles.page}>
    <nav className={styles.nav}><Link href="/">CAIRN LABS</Link><Link href="/auth/session?view=account">내 계정</Link></nav>
    <header className={styles.header}><div><p className={styles.eyebrow}>MEMBERS · 관리자</p><h1>회원 활동</h1><p>최근 접속과 기능 이용을 한눈에.</p></div><Link className={styles.refresh} href="/management/members">새로 확인 ↻</Link></header>
    <div className={styles.stats}>{[["연결된 회원",report.total],["24시간 내 활동",report.recent],["90일 내 재방문",report.returning]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{integer.format(Number(value))}<small>명</small></strong></div>)}</div>
    <div className={styles.heading}><h2>회원별 기록</h2><span>최근 90일 · 한국시간</span></div>
    <div className={styles.list}>{report.rows.length ? report.rows.map(row => <article key={row.id} className={styles.row}>
      <div className={styles.identity}><strong>{row.name || row.email || `회원 ${row.id.slice(0,8)}`}</strong>{row.email && row.name ? <span>{row.email}</span> : null}<small>{row.visits > 1 ? "재방문" : row.visits === 1 ? "첫 방문" : "최근 기록 없음"}</small></div>
      <div><span className={styles.label}>최근 접속</span><time dateTime={row.lastSeen ?? undefined}>{row.lastSeen ? date.format(new Date(row.lastSeen)) : "아직 집계 전"}</time></div>
      <div><span className={styles.label}>방문 / 활동일</span><strong>{integer.format(row.visits)}회 <span className={styles.muted}>/ {integer.format(row.activeDays)}일</span></strong></div>
      <details className={styles.features}><summary>사용 기능 <span>{row.features.length}</span></summary>{row.features.length ? <ul>{row.features.map(item => <li key={item.feature}><span>{ACTIVITY_FEATURES[item.feature as ActivityFeature] ?? "기타"}</span><strong>{integer.format(item.views)}회</strong></li>)}</ul> : <p>새 활동이 생기면 표시됩니다.</p>}</details>
    </article>) : <p className={styles.empty}>아직 표시할 회원이 없습니다.</p>}</div>
    <nav aria-label="회원 목록 페이지" className={styles.pagination}>{report.page > 1 ? <Link href={`/management/members?page=${report.page-1}`}>← 이전</Link> : <span />}<span>{report.page}</span>{report.page*50 < report.total ? <Link href={`/management/members?page=${report.page+1}`}>다음 →</Link> : <span />}</nav>
    <details className={styles.explanation}><summary>집계 기준</summary><p>로그인한 회원이 기능 화면을 열거나 다시 돌아왔을 때 기록합니다. 마지막 활동과 30분 이상 떨어진 활동을 새 방문으로 셉니다. 같은 기능의 1분 이내 반복은 한 번으로 집계합니다.</p><p>방문·활동일·기능 이용은 최근 90일 기준이며, 재방문은 이 기간에 2회 이상 방문한 회원입니다. 이전 기록은 소급하지 않습니다. 화면 조회는 기능 실행·계산 완료를 뜻하지 않습니다.</p><p>최근 접속은 마지막으로 수집된 활동 시각입니다. 익명 방문, 샘플 체험, 인증 화면은 제외됩니다. 포트폴리오가 연결된 활성 계정부터 집계하며, 가입만 완료하고 아직 입력을 시작하지 않은 계정은 포함하지 않습니다. 집계된 회원 {integer.format(report.observed)}명 / 전체 {integer.format(report.total)}명. 기록이 없는 회원의 신원 정보는 다음 로그인 활동 후 표시됩니다.</p></details>
  </main>;
}
