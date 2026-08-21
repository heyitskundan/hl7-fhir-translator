/**
 * RXO/RXR <-> Medication+MedicationRequest, per the official IG's "Segment RXO to
 * MedicationRequest Map" and "Segment RXR to MedicationRequest Map"
 * (build.fhir.org/ig/HL7/v2-to-fhir/ConceptMap-segment-rxo-to-medicationrequest.html and
 * -rxr-to-medicationrequest.html, fetched directly). Wired into RDE^O11 (the message type
 * that actually carries these segments — see rde.ts), the way order.ts's ORC/OBR pairing
 * is wired into ORM^O01/OML^O21.
 *
 * Several RXO fields the IG marks "No mapping" (RXO-6/7/8/10/15/16/17/20/21/22/24 and
 * RXO-27 through RXO-36) are skipped outright, matching the IG's own scope. RXO-19's total
 * daily dose cross-reference into the neighboring RXE segment isn't implemented — this
 * package doesn't otherwise model RXE, and adding it for one field would mean carrying a
 * whole extra segment shape for a value (`dosageInstruction.maxDosePerPeriod`) nothing else
 * here reads or writes. RXR-3 (administration device) and RXR-6 (site modifier) are also
 * skipped: the IG maps RXR-3 into a `Device` extension this package's plain `Reference`
 * shape can't carry, and RXR-6 has no FHIR target in the IG's own map.
 */
import { getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import type { Hl7Field, Hl7Segment } from "../hl7/types.js";
import type { Medication, MedicationRequest, Patient } from "../fhir/types.js";
import { cweToCodeableConcept } from "./datatypes.js";
import type { MappingTrail } from "./common.js";
import { lookupVocabulary, reverseLookupVocabulary } from "./vocabulary.js";

const ROUTE_TABLE = "table-hl70161-to-route-of-administration";

/** ORC-1/RXO/RXR -> a MedicationRequest referencing a Medication built from the same RXO. Order-control-to-status reuses `order.ts`'s `ORDER_CONTROL_TO_STATUS` table shape, inlined here since MedicationRequest's status union differs slightly (no "revoked", just "cancelled"). */
export function rxoRxrToMedicationRequest(
  orderControl: string | undefined,
  rxo: Hl7Segment,
  rxr: Hl7Segment | undefined,
  patient: Patient,
  trail: MappingTrail,
  id = "medicationrequest-1",
  medicationId = "medication-1",
): { medicationRequest: MedicationRequest; medication: Medication } {
  const status: MedicationRequest["status"] =
    orderControl === "CA" ? "cancelled" : orderControl === "CM" ? "completed" : orderControl === "NW" ? "active" : "active";
  if (orderControl) trail.add("ORC-1", "MedicationRequest.status", status, `HL7 order control "${orderControl}"`);

  const medication: Medication = { resourceType: "Medication", id: medicationId };
  const code = cweToCodeableConcept(rxo.fields[1]);
  if (code) {
    medication.code = code;
    trail.add("RXO-1", "Medication.code", getComponent(rxo, 1, 1) ?? "");
  }
  const form = cweToCodeableConcept(rxo.fields[5]);
  if (form) {
    medication.form = form;
    trail.add("RXO-5", "Medication.form", getComponent(rxo, 5, 1) ?? "");
  }
  const numeratorValue = getComponent(rxo, 18, 1);
  const denominatorValue = getComponent(rxo, 25, 1);
  if (numeratorValue || denominatorValue) {
    medication.ingredient = [
      {
        strength: {
          ...(numeratorValue
            ? { numerator: { value: Number(numeratorValue), unit: getComponent(rxo, 19, 2), code: getComponent(rxo, 19, 1) } }
            : {}),
          ...(denominatorValue
            ? { denominator: { value: Number(denominatorValue), unit: getComponent(rxo, 26, 2), code: getComponent(rxo, 26, 1) } }
            : {}),
        },
      },
    ];
    if (numeratorValue) {
      trail.add("RXO-18", "Medication.ingredient[0].strength.numerator.value", numeratorValue);
      const numeratorUnit = getComponent(rxo, 19, 1) ?? getComponent(rxo, 19, 2);
      if (numeratorUnit) trail.add("RXO-19", "Medication.ingredient[0].strength.numerator.code", numeratorUnit);
    }
    if (denominatorValue) {
      trail.add("RXO-25", "Medication.ingredient[0].strength.denominator.value", denominatorValue);
      const denominatorUnit = getComponent(rxo, 26, 1) ?? getComponent(rxo, 26, 2);
      if (denominatorUnit) trail.add("RXO-26", "Medication.ingredient[0].strength.denominator.code", denominatorUnit);
    }
  }

  const medicationRequest: MedicationRequest = {
    resourceType: "MedicationRequest",
    id,
    status,
    intent: "order",
    medicationReference: { reference: `Medication/${medicationId}` },
    subject: { reference: `Patient/${patient.id}` },
  };

  const doseLow = getComponent(rxo, 2, 1);
  const doseHigh = getComponent(rxo, 3, 1);
  if (doseLow || doseHigh) {
    const unitCode = getComponent(rxo, 4, 1);
    const unitText = getComponent(rxo, 4, 2);
    medicationRequest.dosageInstruction = [
      {
        doseAndRate: [
          {
            type: { coding: [{ code: "ordered" }] },
            doseRange: {
              ...(doseLow ? { low: { value: Number(doseLow), ...(unitCode ? { code: unitCode } : { unit: unitText } ) } } : {}),
              ...(doseHigh ? { high: { value: Number(doseHigh), ...(unitCode ? { code: unitCode } : { unit: unitText } ) } } : {}),
            },
          },
        ],
      },
    ];
    if (doseLow) trail.add("RXO-2", "MedicationRequest.dosageInstruction[0].doseAndRate[0].doseRange.low", doseLow);
    if (doseHigh) trail.add("RXO-3", "MedicationRequest.dosageInstruction[0].doseAndRate[0].doseRange.high", doseHigh);
    if (unitCode || unitText) trail.add("RXO-4", "MedicationRequest.dosageInstruction[0].doseAndRate[0].doseRange", unitCode ?? unitText ?? "");
  }

  if (rxr) {
    const routeCode = getField(rxr, 1);
    const route = lookupVocabulary(ROUTE_TABLE, routeCode);
    const site = cweToCodeableConcept(rxr.fields[2]);
    const method = cweToCodeableConcept(rxr.fields[4]);
    const instruction = cweToCodeableConcept(rxr.fields[5]);
    if (route?.code || site || method || instruction) {
      const dosageInstruction = medicationRequest.dosageInstruction?.[0] ?? {};
      if (route?.code) {
        dosageInstruction.route = { coding: [{ system: route.system, code: route.code, display: route.display }] };
        trail.add("RXR-1", "MedicationRequest.dosageInstruction[0].route", route.code, `HL7 route "${routeCode}"`);
      }
      if (site) {
        dosageInstruction.site = site;
        trail.add("RXR-2", "MedicationRequest.dosageInstruction[0].site", getComponent(rxr, 2, 1) ?? "");
      }
      if (method) {
        dosageInstruction.method = method;
        trail.add("RXR-4", "MedicationRequest.dosageInstruction[0].method", getComponent(rxr, 4, 1) ?? "");
      }
      if (instruction) {
        dosageInstruction.additionalInstruction = [instruction];
        trail.add("RXR-5", "MedicationRequest.dosageInstruction[0].additionalInstruction[0]", getComponent(rxr, 5, 1) ?? "");
      }
      medicationRequest.dosageInstruction = [dosageInstruction];
    }
  }

  const allowSubstitutions = cweToCodeableConcept(rxo.fields[9]);
  if (allowSubstitutions) {
    medicationRequest.substitution = { allowedCodeableConcept: allowSubstitutions };
    trail.add("RXO-9", "MedicationRequest.substitution.allowedCodeableConcept", getComponent(rxo, 9, 1) ?? "");
  }

  const dispenseAmount = getComponent(rxo, 11, 1);
  const refills = getField(rxo, 13);
  if (dispenseAmount || refills) {
    medicationRequest.dispenseRequest = {};
    if (dispenseAmount) {
      const dispenseUnitCode = getComponent(rxo, 12, 1);
      const dispenseUnitText = getComponent(rxo, 12, 2);
      medicationRequest.dispenseRequest.quantity = { value: Number(dispenseAmount), code: dispenseUnitCode, unit: dispenseUnitText };
      trail.add("RXO-11", "MedicationRequest.dispenseRequest.quantity.value", dispenseAmount);
      if (dispenseUnitCode || dispenseUnitText) {
        trail.add("RXO-12", "MedicationRequest.dispenseRequest.quantity.code", dispenseUnitCode ?? dispenseUnitText ?? "");
      }
    }
    if (refills) {
      medicationRequest.dispenseRequest.numberOfRepeatsAllowed = Number(refills);
      trail.add("RXO-13", "MedicationRequest.dispenseRequest.numberOfRepeatsAllowed", refills);
    }
  }

  const deaNumber = getComponent(rxo, 14, 1);
  if (deaNumber) {
    medicationRequest.requester = { display: deaNumber };
    trail.add("RXO-14", "MedicationRequest.requester.display", deaNumber, "Ordering provider's DEA number");
  }

  return { medicationRequest, medication };
}

/** Medication+MedicationRequest -> RXO/RXR segments, inverse of `rxoRxrToMedicationRequest`. */
export function medicationRequestToRxoRxr(
  medicationRequest: MedicationRequest,
  medication: Medication | undefined,
  trail: MappingTrail,
): { rxo: Hl7Segment; rxr?: Hl7Segment } {
  const rxoFields: Record<number, Hl7Field> = {};

  const code = medication?.code?.coding?.[0];
  if (code?.code) {
    rxoFields[1] = field(code.code, code.display ?? "");
    trail.add("Medication.code", "RXO-1", code.code);
  }

  const doseAndRate = medicationRequest.dosageInstruction?.[0]?.doseAndRate?.[0];
  const low = doseAndRate?.doseRange?.low;
  const high = doseAndRate?.doseRange?.high;
  if (low?.value !== undefined) {
    rxoFields[2] = field(String(low.value));
    trail.add("MedicationRequest.dosageInstruction[0].doseAndRate[0].doseRange.low", "RXO-2", String(low.value));
  }
  if (high?.value !== undefined) {
    rxoFields[3] = field(String(high.value));
    trail.add("MedicationRequest.dosageInstruction[0].doseAndRate[0].doseRange.high", "RXO-3", String(high.value));
  }
  const unitCode = low?.code ?? high?.code;
  const unitText = low?.unit ?? high?.unit;
  if (unitCode || unitText) {
    rxoFields[4] = field(unitCode ?? "", unitText ?? "");
  }

  const form = medication?.form?.coding?.[0];
  if (form?.code) {
    rxoFields[5] = field(form.code, form.display ?? "");
    trail.add("Medication.form", "RXO-5", form.code);
  }

  const substitution = medicationRequest.substitution?.allowedCodeableConcept?.coding?.[0];
  if (substitution?.code) {
    rxoFields[9] = field(substitution.code, substitution.display ?? "");
    trail.add("MedicationRequest.substitution.allowedCodeableConcept", "RXO-9", substitution.code);
  }

  const dispenseQuantity = medicationRequest.dispenseRequest?.quantity;
  if (dispenseQuantity?.value !== undefined) {
    rxoFields[11] = field(String(dispenseQuantity.value));
    trail.add("MedicationRequest.dispenseRequest.quantity.value", "RXO-11", String(dispenseQuantity.value));
    if (dispenseQuantity.code || dispenseQuantity.unit) {
      rxoFields[12] = field(dispenseQuantity.code ?? "", dispenseQuantity.unit ?? "");
    }
  }
  if (medicationRequest.dispenseRequest?.numberOfRepeatsAllowed !== undefined) {
    rxoFields[13] = field(String(medicationRequest.dispenseRequest.numberOfRepeatsAllowed));
    trail.add(
      "MedicationRequest.dispenseRequest.numberOfRepeatsAllowed",
      "RXO-13",
      String(medicationRequest.dispenseRequest.numberOfRepeatsAllowed),
    );
  }

  const deaNumber = medicationRequest.requester?.display;
  if (deaNumber) {
    rxoFields[14] = field(deaNumber);
    trail.add("MedicationRequest.requester.display", "RXO-14", deaNumber);
  }

  const ingredient = medication?.ingredient?.[0]?.strength;
  if (ingredient?.numerator?.value !== undefined) {
    rxoFields[18] = field(String(ingredient.numerator.value));
    rxoFields[19] = field(ingredient.numerator.code ?? "", ingredient.numerator.unit ?? "");
    trail.add("Medication.ingredient[0].strength.numerator.value", "RXO-18", String(ingredient.numerator.value));
  }
  if (ingredient?.denominator?.value !== undefined) {
    rxoFields[25] = field(String(ingredient.denominator.value));
    rxoFields[26] = field(ingredient.denominator.code ?? "", ingredient.denominator.unit ?? "");
    trail.add("Medication.ingredient[0].strength.denominator.value", "RXO-25", String(ingredient.denominator.value));
  }

  const rxo = segment("RXO", rxoFields);

  const dosageInstruction = medicationRequest.dosageInstruction?.[0];
  const routeCode = dosageInstruction?.route?.coding?.[0]?.code;
  const siteCoding = dosageInstruction?.site?.coding?.[0];
  const methodCoding = dosageInstruction?.method?.coding?.[0];
  const instructionCoding = dosageInstruction?.additionalInstruction?.[0]?.coding?.[0];
  if (!routeCode && !siteCoding && !methodCoding && !instructionCoding) return { rxo };

  const rxrFields: Record<number, Hl7Field> = {};
  if (routeCode) {
    const hl7Route = reverseLookupVocabulary(ROUTE_TABLE, routeCode);
    if (hl7Route) {
      rxrFields[1] = field(hl7Route);
      trail.add("MedicationRequest.dosageInstruction[0].route", "RXR-1", hl7Route);
    }
  }
  if (siteCoding?.code) {
    rxrFields[2] = field(siteCoding.code, siteCoding.display ?? "");
    trail.add("MedicationRequest.dosageInstruction[0].site", "RXR-2", siteCoding.code);
  }
  if (methodCoding?.code) {
    rxrFields[4] = field(methodCoding.code, methodCoding.display ?? "");
    trail.add("MedicationRequest.dosageInstruction[0].method", "RXR-4", methodCoding.code);
  }
  if (instructionCoding?.code) {
    rxrFields[5] = field(instructionCoding.code, instructionCoding.display ?? "");
    trail.add("MedicationRequest.dosageInstruction[0].additionalInstruction[0]", "RXR-5", instructionCoding.code);
  }
  return { rxo, rxr: segment("RXR", rxrFields) };
}
