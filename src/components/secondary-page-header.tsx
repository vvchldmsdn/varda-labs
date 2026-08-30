import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function SecondaryPageHeader() {
  return (
    <header className="varda-secondary-header">
      <Link className="varda-wordmark" href="/">
        <Image src="/varda-mark.png" width={24} height={24} alt="" />
        <span>VARDA-LABS</span>
      </Link>
      <Link
        className="inline-flex items-center gap-2 text-xs text-[var(--muted)] hover:text-[var(--brand)]"
        href="/"
      >
        <ArrowLeft size={14} aria-hidden="true" /> 포트폴리오
      </Link>
    </header>
  );
}
