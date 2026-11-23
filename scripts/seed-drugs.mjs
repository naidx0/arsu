// Builds src/data/drugs.json: an offline snapshot of common medicines from Health Canada's
// Drug Product Database (DPD), https://health-products.canada.ca/api/documentation/dpd-documentation-en.html
// Only marketed products are kept. Run with `npm run seed:drugs`.
import { writeFile } from 'node:fs/promises';

const API = 'https://health-products.canada.ca/api/drug';
const PER_QUERY = 3;
// Kin is for the medicine cabinet at home: products given by needle or drip are left out.
const NOT_HOME = /intraven|intramusc|subcutan|inject|epidural|intrathecal|dialysis|irrigation|intra-/i;
const QUERIES = [
  'TYLENOL', 'TYLENOL COLD', 'TYLENOL ARTHRITIS', 'ADVIL', 'ADVIL COLD', 'MOTRIN', 'ALEVE', 'ASPIRIN', 'NYQUIL', 'DAYQUIL', 'NEOCITRAN',
  'BUCKLEY', 'ROBITUSSIN', 'BENADRYL', 'GRAVOL', 'REACTINE', 'CLARITIN', 'SUDAFED', 'ROBAXACET', 'MIDOL', 'IMODIUM', 'EXCEDRIN', 'SINUTAB',
  'ACETAMINOPHEN', 'IBUPROFEN', 'NAPROXEN', 'DICLOFENAC', 'CELECOXIB',
  'WARFARIN', 'COUMADIN', 'ELIQUIS', 'XARELTO', 'PRADAXA',
  'METFORMIN', 'ATORVASTATIN', 'LIPITOR', 'SIMVASTATIN', 'ROSUVASTATIN',
  'RAMIPRIL', 'LISINOPRIL', 'PERINDOPRIL', 'CANDESARTAN', 'VALSARTAN', 'AMLODIPINE', 'METOPROLOL', 'BISOPROLOL',
  'HYDROCHLOROTHIAZIDE', 'FUROSEMIDE', 'SPIRONOLACTONE', 'POTASSIUM CHLORIDE', 'DIGOXIN', 'AMIODARONE',
  'LEVOTHYROXINE', 'SYNTHROID', 'PANTOPRAZOLE', 'OMEPRAZOLE',
  'SERTRALINE', 'ESCITALOPRAM', 'CITALOPRAM', 'FLUOXETINE', 'PAROXETINE', 'VENLAFAXINE', 'DULOXETINE',
  'LORAZEPAM', 'CLONAZEPAM', 'DIAZEPAM', 'ZOPICLONE',
  'OXYCODONE', 'PERCOCET', 'HYDROMORPHONE', 'MORPHINE', 'CODEINE', 'TRAMADOL', 'GABAPENTIN', 'PREGABALIN',
  'SALBUTAMOL', 'VENTOLIN', 'NITROGLYCERIN', 'SILDENAFIL', 'VIAGRA', 'TADALAFIL',
  'NITROLINGUAL', 'NITRO-DUR', 'NITROSTAT', 'SULFATRIM', 'SEPTRA', 'K-DUR', 'SLOW-K', 'TRAMACET', 'LITHIUM', 'METHOTREXATE', 'SULFAMETHOXAZOLE', 'CLARITHROMYCIN', 'AMOXICILLIN', 'FLUCONAZOLE', 'METRONIDAZOLE', 'PREDNISONE', 'NARCAN',
];

async function get(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${API}/${path}`, { signal: AbortSignal.timeout(30_000) });
      if (response.ok) return await response.json();
    } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
  }
  return null;
}

const byDin = new Map();
const missed = [];
for (const query of QUERIES) {
  const products = (await get(`drugproduct/?brandname=${encodeURIComponent(query)}&lang=en&type=json`)) ?? [];
  const humans = products.filter(product => product.class_name === 'Human')
    .sort((a, b) => String(b.last_update_date).localeCompare(String(a.last_update_date)));
  let kept = 0;
  for (const product of humans.slice(0, 24)) {
    if (kept >= PER_QUERY) break;
    if (byDin.has(product.drug_identification_number)) { kept++; continue; }
    const status = await get(`status/?id=${product.drug_code}&lang=en&type=json`);
    const current = Array.isArray(status) ? status[0] : status;
    if (!current || !/marketed/i.test(current.status ?? '') || /cancel|dormant/i.test(current.status ?? '')) continue;
    if (NOT_HOME.test(product.brand_name)) continue;
    const routes = (await get(`route/?id=${product.drug_code}&lang=en&type=json`)) ?? [];
    const routeNames = (Array.isArray(routes) ? routes : [routes]).map(route => route?.route_of_administration_name ?? '');
    if (!routeNames.length || routeNames.some(name => NOT_HOME.test(name))) continue;
    const ingredients = (await get(`activeingredient/?id=${product.drug_code}&lang=en&type=json`)) ?? [];
    if (!ingredients.length) continue;
    byDin.set(product.drug_identification_number, {
      din: product.drug_identification_number,
      brand: product.brand_name.trim(),
      company: product.company_name.trim(),
      ingredients: ingredients.map(item => ({ name: item.ingredient_name.trim(), strength: `${item.strength} ${item.strength_unit}`.trim() })),
    });
    kept++;
  }
  if (!kept) missed.push(query);
  process.stdout.write(`${query}: ${kept}\n`);
}

const drugs = [...byDin.values()].sort((a, b) => a.brand.localeCompare(b.brand));
await writeFile(new URL('../src/data/drugs.json', import.meta.url), JSON.stringify({ source: 'Health Canada Drug Product Database', fetched: new Date().toISOString().slice(0, 10), drugs }, null, 1) + '\n');
console.log(`Wrote ${drugs.length} products. No marketed match for: ${missed.join(', ') || 'none'}`);
