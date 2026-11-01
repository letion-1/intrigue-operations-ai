export type DraftItem = { catalogId: string; quantity: number };
export type CatalogPrice = { id: string; name: string; price: number; currency: string; is_active: boolean };

/** UI estimate only. The database function independently resolves current catalog prices. */
export function quoteSubtotal(items: DraftItem[], catalog: CatalogPrice[]): number {
  const byId = new Map(catalog.map(item => [item.id, item]));
  let cents = 0;
  for (const item of items) {
    const row = byId.get(item.catalogId);
    if (!row || !row.is_active || row.currency !== "EUR" || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
      throw new Error("Select active EUR catalog items and quantities from 1 to 100.");
    }
    const unitCents = Math.round(Number(row.price) * 100);
    if (!Number.isSafeInteger(unitCents) || unitCents <= 0) throw new Error("One of the catalog prices is invalid.");
    cents += unitCents * item.quantity;
    if (!Number.isSafeInteger(cents) || cents > 10000000000) throw new Error("Quote total exceeds the supported amount.");
  }
  return cents / 100;
}
export function euro(value: number): string {
  return new Intl.NumberFormat("en-DE", { style: "currency", currency: "EUR" }).format(value);
}
