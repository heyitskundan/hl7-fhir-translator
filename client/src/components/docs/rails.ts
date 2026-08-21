export interface RailItem {
  href: string;
  label: string;
  indent?: boolean;
}

// "On this page" anchor lists, one per docs page — kept separate from the page
// components themselves so those files export only a component (react-refresh's
// only-export-components rule needs that for fast refresh to stay reliable).
export const gettingStartedRail: RailItem[] = [
  { href: "#overview", label: "Overview" },
  { href: "#installation", label: "Installation" },
  { href: "#quickstart", label: "Quick start" },
  { href: "#phi", label: "Handling PHI" },
  { href: "#requirements", label: "Requirements" },
];

export const apiReferenceRail: RailItem[] = [
  { href: "#inspect", label: "Inspection" },
  { href: "#inspectInput", label: "inspectInput", indent: true },
  { href: "#translate", label: "Translation" },
  { href: "#translateHl7ToFhir", label: "translateHl7ToFhir", indent: true },
  { href: "#translateFhirToHl7", label: "translateFhirToHl7", indent: true },
  { href: "#types", label: "Result & detection types" },
  { href: "#registry", label: "Supported-type registry" },
  { href: "#parsing", label: "Lower-level parsing" },
  { href: "#errors", label: "Errors" },
  { href: "#cli", label: "CLI reference" },
];

export const dataMappingRail: RailItem[] = [
  { href: "#supported", label: "Supported types" },
  { href: "#adt", label: "ADT → Patient/Encounter" },
  { href: "#oru", label: "ORU → Diagnostic/Observation" },
  { href: "#orm", label: "ORM → ServiceRequest" },
  { href: "#vxu", label: "VXU → Immunization" },
  { href: "#siu", label: "SIU → Appointment" },
  { href: "#oml", label: "OML → ServiceRequest/Specimen" },
  { href: "#mdm", label: "MDM → DocumentReference" },
  { href: "#terminology", label: "Terminology systems" },
];

export const changelogRail: RailItem[] = [
  { href: "#v1-0-0", label: "v1.0.0" },
  { href: "#v0-3-0", label: "v0.3.0" },
  { href: "#v0-2-0", label: "v0.2.0" },
  { href: "#v0-1-0", label: "v0.1.0" },
];
