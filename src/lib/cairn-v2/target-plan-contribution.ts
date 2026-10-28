import "server-only";
import { getReadOnlyTenantAdditionalContributionPreviewForScope } from "@/db/queries/additional-contribution";

// Both frontends use the same owner-scoped target-plan, MA120, FX and cash policy.
export const getBetaAdditionalContributionPreview = getReadOnlyTenantAdditionalContributionPreviewForScope;
