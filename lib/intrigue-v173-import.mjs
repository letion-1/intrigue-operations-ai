/** V17.3A - strict UTF-8 CSV reader for an owner-approved CRM import. */
export const IMPORT_LIMIT = 200;
export const HEADER_FIELDS = Object.freeze(['full_name', 'email', 'phone', 'company_name', 'vehicle']);

export function parseCsv(source) {
  if (typeof source !== 'string' || source.length > 1048576) throw new Error('CSV must be under 1 MB.');
  const text = source.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false, closedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closedQuote = true; }
      else cell += c;
      continue;
    }
    if (closedQuote && c !== ',' && c !== '\r' && c !== '\n' && c !== ' ' && c !== '\t') throw new Error(`Unexpected character after closing quote (row ${rows.length + 1}).`);
    if (c === '"') {
      if (cell !== '' || closedQuote) throw new Error(`Unexpected quotation mark (row ${rows.length + 1}).`);
      quoted = true;
    } else if (c === ',') { row.push(cell.trim()); cell = ''; closedQuote = false; }
    else if (c === '\n' || c === '\r') {
      row.push(cell.trim());
      if (row.some(v => v !== '')) rows.push(row);
      if (rows.length > IMPORT_LIMIT + 1) throw new Error('Maximum 200 contacts per file.');
      row = []; cell = ''; closedQuote = false;
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else cell += c;
  }
  if (quoted) throw new Error('Unclosed quotation mark in CSV.');
  if (cell || row.length || closedQuote) { row.push(cell.trim()); if (row.some(v => v !== '')) rows.push(row); }
  if (rows.length < 2) throw new Error('CSV needs a header and at least one contact.');
  if (rows.length > IMPORT_LIMIT + 1) throw new Error('Maximum 200 contacts per file.');
  const headers = rows[0];
  if (!headers.length || headers.length > 30 || headers.some(h => !h || h.length > 120)) throw new Error('Invalid CSV headers.');
  if (new Set(headers.map(h => h.toLowerCase())).size !== headers.length) throw new Error('CSV headers must be unique.');
  const records = rows.slice(1).map((cells, i) => {
    if (cells.length !== headers.length) throw new Error(`Row ${i + 2} has ${cells.length} columns; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((h, n) => [h, cells[n]]));
  });
  return { headers, records };
}

const ALIASES = Object.freeze({
  full_name: ['full_name', 'fullname', 'name', 'customer name', 'customer_name', 'contact name', 'contact_name'],
  email: ['email', 'email address', 'email_address', 'e-mail', 'mail'],
  phone: ['phone', 'telephone', 'phone number', 'phone_number', 'mobile', 'mobile phone'],
  company_name: ['company', 'company name', 'company_name', 'organization', 'organisation'],
  vehicle: ['vehicle', 'car', 'vehicle model', 'vehicle_model'],
});
export function suggestMapping(headers) {
  return Object.fromEntries(HEADER_FIELDS.map(field => [field,
    headers.find(h => ALIASES[field].includes(String(h).trim().toLowerCase())) || ''
  ]));
}
export function mapRows(records, mapping) {
  if (!Array.isArray(records) || records.length === 0 || records.length > IMPORT_LIMIT) throw new Error('Import 1 to 200 contacts.');
  if (!mapping?.full_name || !mapping?.email || mapping.full_name === mapping.email) throw new Error('Map separate name and email columns.');
  const selected = HEADER_FIELDS.map(f => mapping[f]).filter(Boolean);
  if (new Set(selected).size !== selected.length) throw new Error('A file column cannot be mapped to multiple fields.');
  return records.map(rec => Object.fromEntries(HEADER_FIELDS.map(field => [field, mapping[field] ? String(rec[mapping[field]] ?? '').trim() : ''])));
}
