"""Verify retained capture contents without extraction, network, or provider execution."""
from pathlib import Path
import base64, hashlib, io, json, tarfile
root = Path(__file__).resolve().parent
for name, expected in json.loads((root / 'sha256.json').read_text()).items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, name
with tarfile.open(root / 'capture.tar.xz') as archive:
    names = archive.getnames()
    assert len(names) == len(set(names))
    assert all(not Path(name).is_absolute() and '..' not in Path(name).parts for name in names)
    data = {member.name: archive.extractfile(member).read() for member in archive if member.isfile()}
provenance = json.loads(data['provenance.json'])
assert provenance['compilerCommit'] == '7502c14d8c0ff4d99795786a364fc69c8755185e'
assert provenance['fixtureRevision'] == '4719dc509fdc45656a830e3ed6060f674e206076'
assert provenance['providerExecution'] is False
historical = root.parent / '2026-10-30-set-433-external-evidence/raw-captures.tar.xz'
with tarfile.open(historical) as archive:
    original = archive.extractfile(provenance['historicalArchiveMember']).read()
assert hashlib.sha256(original).hexdigest() == provenance['originalArchiveSha256']
before, after = json.loads(data['before.json']), json.loads(data['after.json'])
assert len(before) == 576 and before == after
assert len({entry['path'] for entry in before}) == len(before)
original_files = {}
with tarfile.open(fileobj=io.BytesIO(original)) as archive:
    assert len(archive.getnames()) == len(set(archive.getnames()))
    members = {member.name: member for member in archive if member.isfile() or member.issym()}
    assert set(members) == {entry['path'] for entry in before}
    for entry in before:
        member = members[entry['path']]
        if member.issym():
            assert entry['link'] == member.linkname
        else:
            content = archive.extractfile(member).read()
            assert entry['sha256'] == hashlib.sha256(content).hexdigest()
            original_files[entry['path']] = content
outputs = json.loads(data['outputs.json'])
assert len(outputs) == 22 and len({entry['path'] for entry in outputs}) == 22
files = {}
for entry in outputs:
    content = base64.b64decode(entry['content'], validate=True)
    assert hashlib.sha256(content).hexdigest() == entry['sha256']
    files[entry['path']] = content
for native_path, emitted_path in [('.claude-plugin/plugin.json', '.claude-plugin/plugin.json'), ('.codex-plugin/plugin.json', 'plugin.json'), ('.cursor-plugin/plugin.json', '.cursor-plugin/plugin.json')]:
    expected = json.loads(original_files[f'plugins/coding-tutor/{native_path}'])['keywords']
    actual = json.loads(files[f'plugins/coding-tutor/{emitted_path}'])['keywords']
    assert actual == expected, native_path
report = json.loads(data['report.json'])
assert report['ok'] is False and report['builtFiles'] == 22
assert report['surveyDiagnostics'] == [] and report.get('buildError') is None
assert [entry['ok'] for entry in report['imports']] == [True, False]
assert 'license metadata and bundled license text' in report['imports'][1]['detail']
assert not any(path.startswith('plugins/compound-engineering/') for path in files)
summary = json.loads(data['summary.json'])
assert summary['originalFilesAndLinks'] == 576 and summary['originalsUnchanged'] is True
assert summary['outputFiles'] == 22 and summary['ok'] is False
print(json.dumps({'originalFilesAndLinks': 576, 'originalBytesLinksAndExtractedModesUnchanged': True, 'outputFiles': 22, 'codingTutorKeywordListsMatchOriginals': True, 'compoundEngineeringLicenseBlocked': True, 'providerExecution': False}))
