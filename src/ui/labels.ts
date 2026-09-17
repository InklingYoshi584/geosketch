/**
 * Names objects are shown under in the UI chrome. One place, because the chip
 * and the inspector must agree: "A" on the board is "A" in the popover.
 */
import { registry, type Doc, type Id } from '../engine';

/** The Chinese title of a registered type, falling back to its raw name. */
export function typeTitle(type: string): string {
  return registry.get(type)?.title ?? type;
}

/** The name an object is shown under: its label if it has one, else its type. */
export function objectLabel(doc: Doc, id: Id): string {
  const rec = doc.objects.find((object) => object.id === id);
  if (rec === undefined) return id;
  return rec.label?.text ?? typeTitle(rec.type);
}
