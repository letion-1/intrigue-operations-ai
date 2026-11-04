export const IMPORT_LIMIT: number;
export const HEADER_FIELDS: readonly string[];
export function parseCsv(source: string): { headers: string[]; records: Record<string, string>[] };
export function suggestMapping(headers: string[]): Record<string, string>;
export function mapRows(records: Record<string, string>[], mapping: Record<string, string>): Record<string, string>[];
