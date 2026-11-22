from pathlib import Path
import textwrap

W, H = 612, 792
INK = '0.12 0.16 0.20'
MUTED = '0.32 0.38 0.43'
ACCENT = '0.02 0.37 0.49'
PAGES = []
COMMANDS = []
LINKS = []


def escape(value):
    return str(value).replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


def text(x, y, value, size=11, font='F1', color=INK):
    COMMANDS.append(f'BT /{font} {size} Tf {color} rg 1 0 0 1 {x} {H-y} Tm ({escape(value)}) Tj ET')


def para(y, value, width=83, x=50, size=11, leading=16, font='F1'):
    for line in textwrap.wrap(value, width=width, break_long_words=False):
        text(x, y, line, size, font)
        y += leading
    return y


def rule(y):
    COMMANDS.append(f'0.80 0.84 0.87 RG 0.7 w 50 {H-y} m 562 {H-y} l S')


def box(y, title, detail, height=90):
    COMMANDS.append(f'0.95 0.97 0.98 rg 50 {H-y-height} 512 {height} re f')
    text(66, y+24, title, 14, 'F2', ACCENT)
    para(y+46, detail, width=76, x=66)


def arrow(y):
    COMMANDS.append(f'{ACCENT} RG 1.5 w 306 {H-y} m 306 {H-y-18} l S')
    COMMANDS.append(f'{ACCENT} rg 302 {H-y-14} m 310 {H-y-14} l 306 {H-y-21} l h f')


def heading(kicker, title):
    global COMMANDS, LINKS
    COMMANDS, LINKS = [], []
    text(50, 38, f'ARSU / ONTOLOGY FIELD GUIDE / {kicker}', 9, 'F2', ACCENT)
    text(50, 82, title, 26, 'F2')
    rule(105)


def finish():
    rule(746)
    text(50, 766, 'Public-reference practice. Not an operational aviation control system.', 8, color=MUTED)
    text(540, 766, str(len(PAGES)+1), 9, 'F2')
    PAGES.append(('\n'.join(COMMANDS).encode('ascii'), list(LINKS)))


heading('01 / THE MODEL', 'One model. Three layers.')
y = para(136, 'An ontology is a shared, typed model of things, relationships, and evidence. It connects a low-level observation to the service and operational decision that depend on it. A graph drawing is only the visible projection of that model.')
box(222, '1  Infrastructure', 'Gateway host, broker host, consumer host. These are modeled hosts from our repository manifest. A host can be up while its application delivers unusable data.')
arrow(316)
box(342, '2  Communications - the first detailed slice', 'Notice publisher, message broker, standby, and message consumer. Inspect who sends to whom, the message envelope, sequence, age, and payload integrity.')
arrow(436)
box(462, '3  Operations', 'A modeled release decision depends on valid communication. The demo blocks releases when the consumer degrades. This is not certified flight-dispatch logic.')
para(593, 'Across all three layers, agents write to one Blackboard: nodes, dependency edges, executable contracts, violations, response tasks, and event receipts. Agents coordinate through those records, not private messages.')
para(670, 'The practice profile has 8 components, 7 dependency links, and 34 checks in deterministic SIM mode. These counts describe our model, not the real North American aviation network.', font='F2')
finish()

heading('02 / THE ONTOLOGY', 'From a log line to a typed fact')
y = para(138, 'Example: the message consumer receives a payload whose calculated SHA-256 differs from the attached digest. The receiver records that observation. A contract fails. The swarm links the failure to the affected component and its downstream release decision.')
rows = [
    ('Node / what exists', 'nodes/message-consumer: a communications-layer worker, discovered by recon. Provenance says modeled and identifies the repository manifest.'),
    ('Edge / what depends on what', 'message-consumer -> message-broker means the consumer depends on the broker. It does not mean a packet travels in that direction. The envelope separately records source and destination.'),
    ('Contract / what must hold', 'A data_field invariant reads /sim/communications/status. The integrityOk field must equal boolean true. Sequence and freshness have separate contracts.'),
    ('Violation / what was observed', 'The runner records the failed invariant, node, detail, first/last observation time, and lifecycle status. A failing observation is not a proven root cause.'),
    ('Task / what will respond', 'The orchestrator checks dependencies and chooses a skill. A response unit claims the task through the Blackboard, executes it, and re-runs checks.'),
    ('Evidence / what can be inspected', 'The run export contains a baseline, final proof results, topology, tasks, violations, and execution receipts. Packet receipts show the synthetic payload and validation outcomes.'),
]
y = 228
for title, body in rows:
    text(50, y, title, 13, 'F2', ACCENT)
    y = para(y+21, body, width=84) + 19
finish()

heading('03 / THE MESSAGE', 'What our communication looks like')
y = para(138, 'FAA SWIM is a public architectural reference for producer/distribution/consumer patterns. Our replay is an educational JSON model running inside the ARSU process. HTTP exposes observations. It does not implement JMS, radio communications, or ASTERIX binary decoding.')
packet = [
    '{',
    '  "id": "1-42", "epoch": 1, "sequence": 42,',
    '  "source": "notam-source",',
    '  "destination": "message-consumer",',
    '  "topic": "practice.aeronautical.notices",',
    '  "sentAt": 100000, "receivedAt": 100000,',
    '  "payload": {',
    '    "noticeId": "SIM-00042", "airport": "KJFK",',
    '    "text": "TRAINING ONLY: modeled update"',
    '  },',
    '  "digest": "SHA-256 of serialized payload",',
    '  "integrityOk": true, "sequenceOk": true,',
    '  "freshnessOk": true, "outcome": "accepted"',
    '}',
]
y = 240
for line in packet:
    text(62, y, line, 10, 'F3')
    y += 17
text(50, 514, 'Three separate questions', 14, 'F2', ACCENT)
y = para(540, 'Integrity: is the received payload identical to the payload covered by its digest? Sequence: is it the next expected message in this stream epoch? Freshness: is its timestamp between now and five seconds ago?')
y = para(y+16, 'An unkeyed SHA-256 digest detects payload corruption in this exercise. It does not authenticate the sender: a capable attacker could recalculate it. Real identity, authorization, signing, TLS, clock management, and protocol decoding need their own verified adapters.')
para(y+16, 'Sequence numbers and epochs are our training envelope, not a claim that every aviation protocol uses these exact fields. A NOTAM is not an ADS-B target report.', font='F2')
finish()

heading('04 / THE RESPONSE', 'Break it. Observe it. Verify it.')
rows = [
    ('Payload corruption', 'The harness changes payload text after calculating the digest. The receiver rejects it, integrityOk latches false, and an executable integrity check fails.'),
    ('Omitted delivery', 'The harness omits alternating deliveries. The receiver detects a sequence gap on the next arrival. Omission logs are harness observations; the receiver does not magically see a missing packet.'),
    ('Message replay', 'A previously accepted envelope is delivered again. Its payload digest can still be valid. The repeated sequence detects replay, independently of integrity.'),
    ('Stale delivery', 'The harness delivers a message with a timestamp two minutes old. The five-second freshness check fails even if payload integrity is valid.'),
]
y = 142
for title, body in rows:
    text(50, y, title, 14, 'F2', ACCENT)
    y = para(y+22, body) + 27
rule(y)
y += 30
text(50, y, 'What counts as recovery?', 14, 'F2', ACCENT)
y = para(y+24, 'The runner must observe a failure. A response action must succeed. Every covered check must pass again after that response, with no unresolved violations, failed work, ground stop, or stale-feed flag. Triage alone is not resolution.')
y = para(y+14, 'In this lab, restart/repair clears the injected channel condition and starts a new stream epoch with a new valid message. Earlier rejected receipts remain available. A failed or escalated run is retained as failed; it is never painted green for the demo.')
para(y+14, 'Passing checks establish a bounded claim about this model and these observations. They are not a proof of universal correctness, aviation safety, or detection of every possible attack.', font='F2')
finish()

heading('05 / THE SOURCES', 'Published facts versus our model')
y = para(138, 'Use primary technical sources before tertiary summaries. The links below support concepts, not private deployment details. The demo contains no real FAA server addresses, center-to-center network map, intercepted traffic, or operational NOTAM feed.')
refs = [
    ('FAA - SFDPS', 'https://www.faa.gov/air_traffic/technology/swim/sfdps', 'Documents en-route data publication, transformation to SWIM-compliant XML, enterprise messaging, and authorized consumers. It does not establish our host arrangement.'),
    ('FAA - SWIM JMS developer workshop', 'https://www.faa.gov/media/19536', 'Describes JMS publish/subscribe messaging and producer/consumer decoupling. JMS is an API; our in-process replay is not a JMS implementation.'),
    ('EUROCONTROL - ASTERIX CAT021', 'https://www.eurocontrol.int/publication/cat021-eurocontrol-specification-surveillance-data-exchange-asterix-part-12-category-21', 'CAT021 edition 2.7 describes ADS-B target-report structures. Included as a surveillance-format reference and a future adapter boundary, not a decoder we have built.'),
    ('Docker - startup and readiness', 'https://docs.docker.com/compose/how-tos/startup-order/', 'Explains that started is not the same as ready and that dependencies can be gated by health checks. Our hosts remain modeled; this demo does not launch containers.'),
]
y = 236
for title, url, fact in refs:
    text(50, y, title, 14, 'F2', ACCENT)
    LINKS.append((50, H-y-4, 550, H-y+15, url))
    y = para(y+23, fact) + 12
    text(50, y, 'Open primary source: click the heading above.', 9, color=MUTED)
    y += 35
para(y+2, 'Repository truth: packages/sim/src/practice.ts declares the modeled components and dependencies. Recon reads their local registry and health/operation endpoints. Source IDs and manifest provenance survive in the ontology and evidence export.', font='F2')
finish()

heading('06 / RUN AND EXTEND', 'A practice demo you can inspect')
y = para(138, 'Start with npm run dev:practice. It builds the dashboard and starts an empty in-memory board on port 4780. Stop any host already occupying that port first. Recording mode does not overwrite the saved mission board.')
box(226, 'The recording take', 'Open Swarm. Launch the environment. Watch discovery build the three layers and contracts. Wait for readiness gates. Choose one communication fault. Inspect receipts and response events. Download the completed evidence JSON.', height=105)
y = para(365, 'The Infrastructure tab also shows observed ARSU-process uptime and resident memory, plus logical CPU count reported by the operating system. Those measurements belong to the real host process. They are not measurements of the three modeled hosts.')
y = para(y+18, 'The original airline-outage rehearsal remains available with npm run dev:recording. The test:mission command starts isolated hosts, forces SIM, and verifies both profiles. Gemini reasoning remains behind ModelProvider; the automated replay tests do not prove live Gemini availability.')
text(50, y+36, 'The next adapter, one layer at a time', 14, 'F2', ACCENT)
y = para(y+62, 'For an authorized repository: parse a declared service manifest and preserve file/line provenance. Do not infer runtime liveness from a dependency declaration. For local services: add explicit allowlisted health endpoints and measured process/container signals. Do not scan arbitrary networks.')
y = para(y+14, 'For real aviation data: obtain authorized access, implement the actual protocol/schema, keep original units and timestamps, and replay captured fixtures in isolation. Map every normalized field back to its original record. Add new checks and negative controls before enabling response actions.')
para(y+14, 'Download evidence before stopping an ephemeral host. Wikipedia can add background later; it should not be the authority for protocol semantics or live system state.', font='F2')
finish()

objects = [b'', b'', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>']


def add(value):
    objects.append(value)
    return len(objects)


page_ids = []
for content, links in PAGES:
    stream = add(f'<< /Length {len(content)} >>\nstream\n'.encode('ascii') + content + b'\nendstream')
    annots = []
    for x1, y1, x2, y2, url in links:
        annots.append(add(f'<< /Type /Annot /Subtype /Link /Rect [{x1} {y1} {x2} {y2}] /Border [0 0 0] /A << /S /URI /URI ({escape(url)}) >> >>'.encode('ascii')))
    annotations = ' /Annots [' + ' '.join(f'{n} 0 R' for n in annots) + ']' if annots else ''
    page_ids.append(add(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents {stream} 0 R{annotations} >>'.encode('ascii')))
objects[0] = b'<< /Type /Catalog /Pages 2 0 R >>'
objects[1] = ('<< /Type /Pages /Count ' + str(len(page_ids)) + ' /Kids [' + ' '.join(f'{n} 0 R' for n in page_ids) + '] >>').encode('ascii')
output = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\x00\n')
offsets = [0]
for i, obj in enumerate(objects, 1):
    offsets.append(len(output))
    output.extend(f'{i} 0 obj\n'.encode('ascii') + obj + b'\nendobj\n')
xref = len(output)
output.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode('ascii'))
for offset in offsets[1:]:
    output.extend(f'{offset:010d} 00000 n \n'.encode('ascii'))
output.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode('ascii'))
path = Path(__file__).with_name('ARSU-Ontology-Guide.pdf')
path.write_bytes(output)
print(f'{path}: {len(PAGES)} pages, {len(output)} bytes')
