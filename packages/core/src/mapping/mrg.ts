/**
 * MRG <-> Account, per the official IG's "Segment MRG to Account Map"
 * (build.fhir.org/ig/HL7/v2-to-fhir/ConceptMap-segment-mrg-to-account.html, fetched
 * directly). MRG carries the identifiers of a patient identity being merged away into the
 * message's PID — this package models that as an Account referencing the surviving
 * Patient (the one built from PID) and carrying the retired identifier from MRG-3. MRG-1/2/
 * 4/5/6/7 (the prior patient/visit identifiers and name) have no FHIR target in the IG's own
 * map and are left unmapped for the same reason. `status` is always synthesized as
 * `"unknown"` — the IG's own note says the prior account may already be active or inactive,
 * with nothing in MRG itself to distinguish the two.
 */
import { findSegments } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import type { Hl7Message, Hl7Segment } from "../hl7/types.js";
import type { Account, Patient } from "../fhir/types.js";
import { cxToIdentifier } from "./datatypes.js";
import type { MappingTrail } from "./common.js";

/** MRG segments -> zero or more Account resources, one per segment, each referencing the surviving `patient`. */
export function mrgToAccounts(message: Hl7Message, patient: Patient, trail: MappingTrail): Account[] {
  return findSegments(message, "MRG").map((mrg, i) => {
    const account: Account = { resourceType: "Account", id: `account-${i + 1}`, status: "unknown", subject: [{ reference: `Patient/${patient.id}` }] };
    const identifier = cxToIdentifier(mrg.fields[3]);
    if (identifier) {
      account.identifier = [identifier];
      trail.add("MRG-3", "Account.identifier[0]", identifier.value ?? "");
    }
    return account;
  });
}

/** Account resources -> MRG segments, inverse of `mrgToAccounts`. */
export function accountsToMrg(accounts: Account[], trail: MappingTrail): Hl7Segment[] {
  return accounts.map((account) => {
    const value = account.identifier?.[0]?.value;
    if (value) trail.add("Account.identifier[0]", "MRG-3", value);
    return segment("MRG", value ? { 3: field(value) } : {});
  });
}
