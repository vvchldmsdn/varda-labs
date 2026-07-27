import {
  runIdentityPairingCatalogAuditProcess,
} from "./lib/identity-pairing-catalog-preflight.mjs";

const result = runIdentityPairingCatalogAuditProcess();
if (result.status === "failed") {
  console.error(
    JSON.stringify({
      preflight: "identity_pairing_catalog_child_audit",
      status: "failed",
      code: result.code,
    }),
  );
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(result.evidence, null, 2));
}
