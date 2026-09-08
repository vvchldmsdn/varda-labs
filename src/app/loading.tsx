import { ManagementElement, ManagementText } from "@/components/i18n/management-text";
import { SecondaryPageHeader } from "@/components/secondary-page-header";

export default function AppLoading() {
  return (
    <ManagementElement as="main" className="varda-page varda-stage-page" aria-busy="true" aria-label="화면을 불러오는 중">
      <SecondaryPageHeader />
      <div className="varda-content varda-stage-content">
        <section className="varda-loading" role="status">
          <p><span className="varda-loading-dots" aria-hidden="true"><i /><i /><i /></span><ManagementText>{"화면을 준비하고 있어요"}</ManagementText></p>
          <div className="varda-loading-title" aria-hidden="true" />
          <div className="varda-loading-visual" aria-hidden="true">
            {Array.from({ length: 32 }, (_, index) => (
              <i key={index} style={{ height: `${45 + (index * 23) % 130}px`, animationDelay: `${index * 35}ms` }} />
            ))}
          </div>
          <div className="varda-loading-footer" aria-hidden="true" />
        </section>
      </div>
    </ManagementElement>
  );
}
