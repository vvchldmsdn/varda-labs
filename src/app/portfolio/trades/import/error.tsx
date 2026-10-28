"use client";
import Link from "next/link";
import { Button, PageTitle } from "@/components/cairn-ui";
export default function TradeImportError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main style={{ maxWidth: 640, margin: "80px auto", padding: 24 }}><PageTitle>거래 정보를 불러오지 못했어요.</PageTitle><p>기존 기록은 그대로입니다. 다시 불러온 후 사진을 선택해 주세요.</p><Button onClick={retry}>다시 불러오기</Button><p><Link href="/portfolio/ledger">직접 거래 입력으로</Link></p></main>;
}
