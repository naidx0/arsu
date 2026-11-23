import { useEffect, useMemo, useState } from 'react';
import { readLabels } from '../ai/brain';
import { checkMedicines, describeIngredients, searchDrugs, titleCase, type Drug, type Medicine as Med } from '../core/meds';
import snapshot from '../data/drugs.json';
import { lookupDrug } from '../sensors';
import { personal, usePersonal } from '../store/personal';
import { go, useOnline, useT, useTier } from '../ui/hooks';
import { Button, Card, Chip, Icon, IconButton, Row, Sheet, TopBar } from '../ui/kit';

const DRUGS = snapshot.drugs as Drug[];
const TIMES = [{ key: 'morning', time: '08:00' }, { key: 'noon', time: '12:00' }, { key: 'evening', time: '18:00' }, { key: 'bedtime', time: '22:00' }];

function add(drug: Drug) {
  personal.set(current => {
    if (drug.din && current.medicines.some(item => item.din === drug.din)) return {};
    const medicine: Med = { ...drug, id: crypto.randomUUID(), times: [], addedAt: Date.now() };
    return { medicines: [...current.medicines, medicine] };
  });
}

export function Medicine() {
  const { t, lang } = useT();
  const state = usePersonal();
  const online = useOnline();
  const tier = useTier();
  const [query, setQuery] = useState('');
  const [live, setLive] = useState<Drug[]>([]);
  const [searching, setSearching] = useState(false);
  const [scan, setScan] = useState<{ state: 'reading' | 'done' | 'failed'; matches: Drug[]; unread: string[] } | null>(null);

  const findings = useMemo(() => checkMedicines(state.medicines), [state.medicines]);
  const local = useMemo(() => searchDrugs(query, DRUGS, 6), [query]);
  const nameOf = (id: string) => titleCase(state.medicines.find(item => item.id === id)?.brand ?? '');

  // Ask the live Health Canada database too, a moment after typing stops.
  useEffect(() => {
    setLive([]);
    const text = query.trim();
    if (text.length < 3 || !online) { setSearching(false); return; }
    setSearching(true);
    let current = true;
    const timer = setTimeout(async () => {
      const found = await lookupDrug(text, 5);
      if (current) { setLive(found); setSearching(false); }
    }, 500);
    return () => { current = false; clearTimeout(timer); };
  }, [query, online]);

  const results = [...local, ...live.filter(drug => !local.some(item => item.din === drug.din))].filter(drug => !state.medicines.some(item => item.din === drug.din)).slice(0, 8);

  const onPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setScan({ state: 'reading', matches: [], unread: [] });
    const reads = await readLabels([...files]);
    if (!reads) { setScan({ state: 'failed', matches: [], unread: [] }); return; }
    const matches: Drug[] = [], unread: string[] = [];
    for (const read of reads) {
      // The label is only a search term. What gets added is the Health Canada record.
      const drug = (read.din && DRUGS.find(item => item.din === read.din)) || (read.din ? (await lookupDrug(read.din, 1))[0] : undefined) || searchDrugs(read.brand, DRUGS, 1)[0] || (await lookupDrug(read.brand, 1))[0];
      if (drug && !matches.some(item => item.din === drug.din)) matches.push(drug); else if (!drug) unread.push(read.brand || read.din || '?');
    }
    setScan({ state: 'done', matches, unread });
  };

  return (
    <div className="screen">
      <TopBar title={t('med.title')} onBack={() => go('/')} backLabel={t('common.back')} />

      {findings.map((finding, index) => (
        <Card key={index} tone={finding.severity === 'high' ? 'error' : 'soon'} className="finding" label={t('med.ask')}>
          <Row icon={finding.severity === 'high' ? 'error' : 'warning'} title={t(finding.severity === 'high' ? 'med.askHigh' : 'med.ask')} sub={finding.medicines.map(nameOf).join(' + ')} />
          <p>{finding.why[lang]}</p>
          <p className="fine">{finding.basis}</p>
        </Card>
      ))}
      {state.medicines.length >= 2 && findings.length === 0 && (
        <Card tone="outline"><Row icon="info" title={t('med.none')} sub={t('med.noneBody')} /></Card>
      )}

      <Card tone="low" label={t('med.add')}>
        <h2 className="card-title">{t('med.add')}</h2>
        <label className="search">
          <Icon name="search" />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('med.searchHint')} aria-label={t('med.searchHint')} />
        </label>
        {results.length > 0 && (
          <ul className="results">
            {results.map(drug => (
              <li key={drug.din ?? drug.brand}>
                <button type="button" className="result-row" onClick={() => { add(drug); setQuery(''); }}>
                  <span className="result-main"><strong>{titleCase(drug.brand)}</strong><span>{describeIngredients(drug)}</span></span>
                  <Icon name="add" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim().length >= 2 && results.length === 0 && <p className="fine">{t(searching ? 'med.searching' : online ? 'med.noMatch' : 'med.noMatchOffline')}</p>}
        <label className={`btn btn-tonal file-btn ${tier === 'cloud' ? '' : 'btn-off'}`}>
          <Icon name="document_scanner" size={20} /><span>{t('med.scan')}</span>
          <input type="file" accept="image/*" capture="environment" multiple disabled={tier !== 'cloud'} onChange={event => { void onPhotos(event.target.files); event.target.value = ''; }} />
        </label>
        {tier !== 'cloud' && <p className="fine">{t('med.scanNeeds')}</p>}
      </Card>

      {state.medicines.length === 0 && <p className="lead center">{t('med.empty')}</p>}
      {state.medicines.map(medicine => (
        <Card key={medicine.id} tone="low" label={titleCase(medicine.brand)}>
          <Row icon="pill" tone="primary" title={titleCase(medicine.brand)} sub={<>{describeIngredients(medicine)}{medicine.din && <><br />DIN {medicine.din}</>}</>}
            end={<IconButton icon="delete" label={t('med.remove', { name: titleCase(medicine.brand) })} onClick={() => personal.set(current => ({ medicines: current.medicines.filter(item => item.id !== medicine.id) }))} />} />
          <div className="chips">
            {TIMES.map(slot => (
              <Chip key={slot.key} selected={medicine.times.includes(slot.time)}
                onClick={() => personal.set(current => ({ medicines: current.medicines.map(item => item.id !== medicine.id ? item : { ...item, times: item.times.includes(slot.time) ? item.times.filter(time => time !== slot.time) : [...item.times, slot.time].sort() }) }))}>
                {t(`med.time.${slot.key}`)}
              </Chip>
            ))}
          </div>
        </Card>
      ))}

      <p className="fine">{t('med.source', { date: snapshot.fetched, n: DRUGS.length })}</p>
      <p className="fine">{t('med.disclaimer')}</p>

      <Sheet open={Boolean(scan)} onClose={() => setScan(null)} title={t('med.scan')}>
        {scan?.state === 'reading' && <p className="lead">{t('med.reading')}</p>}
        {scan?.state === 'failed' && <p className="lead">{t('med.scanFailed')}</p>}
        {scan?.state === 'done' && (
          <>
            <p className="lead">{t(scan.matches.length ? 'med.scanFound' : 'med.scanNothing')}</p>
            {scan.matches.map(drug => <Row key={drug.din} icon="pill" tone="primary" title={titleCase(drug.brand)} sub={describeIngredients(drug)} />)}
            {scan.unread.length > 0 && <p className="fine">{t('med.scanUnread', { names: scan.unread.join(', ') })}</p>}
            {scan.matches.length > 0 && <Button variant="filled" block large icon="add" onClick={() => { scan.matches.forEach(add); setScan(null); }}>{t('med.addThese', { n: scan.matches.length })}</Button>}
          </>
        )}
      </Sheet>
    </div>
  );
}
