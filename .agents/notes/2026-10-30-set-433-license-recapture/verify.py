from pathlib import Path
import tarfile, json, hashlib, io
root=Path(__file__).resolve().parent
base=root.parent/'2026-10-30-set-433-external-evidence'
def read(path):
    with tarfile.open(path) as t:
        members=t.getmembers()
        names=[m.name for m in members]
        assert len(names)==len(set(names)), 'duplicate archive member'
        assert all(not Path(n).is_absolute() and '..' not in Path(n).parts for n in names)
        return {m.name:t.extractfile(m).read() for m in members if m.isfile() and not any(p.startswith('._') for p in Path(m.name).parts)}
for path,expected in json.loads((root/'sha256.json').read_text()).items():
    assert hashlib.sha256((root/path).read_bytes()).hexdigest()==expected,path
old=read(base/'raw-captures.tar.xz')
new=read(root/'capture.tar.xz')
provenance=json.loads(new['provenance.json'])
historical=json.loads(old['set433-external-8a5d-a/provenance.json'])
assert provenance['codeSHA']=='95951b07b821e9120ee6aae9bbadac0dd21b0939'
assert provenance['manifestSha256']==hashlib.sha256((base/'fixture-manifest.yaml').read_bytes()).hexdigest()
assert provenance['entries']==historical['entries']
assert len(provenance['entries'])==7
a={p.removeprefix('set433-external-8a5d-a/'):v for p,v in old.items() if p.startswith('set433-external-8a5d-a/') and '/projection-0/' in p}
b={p:v for p,v in new.items() if '/projection-0/' in p}
same={p for p in a.keys()&b.keys() if a[p]==b[p]}
added=b.keys()-a.keys(); removed=a.keys()-b.keys()
assert (len(a),len(b),len(same),len(added),len(removed))==(88,115,80,35,8)
assert not any(a[p]!=b[p] for p in a.keys()&b.keys())
with tarfile.open(fileobj=io.BytesIO(old['set433-external-8a5d-a/mattpocock-skills/original.tar'])) as t:
    license=t.extractfile('LICENSE').read()
for p in added:
    assert p.startswith('mattpocock-skills/projection-0/') and p.endswith('LICENSE.txt')
    assert b[p]==license,p
refs=json.loads((root/'original-refs.json').read_text())
assert set(refs)=={e['name'] for e in provenance['entries']}
for name,row in refs.items():
    assert hashlib.sha256(old[f'set433-external-8a5d-a/{name}/original.tar']).hexdigest()==row['sha256']
assert all(p.startswith('cursor-browser-motion-plugin/') for p in removed)
print(json.dumps({'before':len(a),'after':len(b),'same':len(same),'added_notices_exact_original':len(added),'blocked_cursor_outputs':len(removed),'original_archive_references':len(refs)}))

expected_blocked={'compound-engineering-plugin':'init','cursor-browser-motion-plugin':'import','emilkowalski-skills':'build','last30days-skill':'import'}
for entry in provenance['entries']:
    name=entry['name']
    report=json.loads(new[f'{name}/raw-report.json'])['report']
    if name in expected_blocked:
        assert report['ok'] is False
        assert not report['roundTrips']
        assert any(s['stage']==expected_blocked[name] and not s['ok'] for s in report['stages'])
        assert not any(p.startswith(name+'/projection-0/') for p in b)
    else:
        assert report['ok'] is True and len(report['roundTrips'])==1
    if name=='cursor-browser-motion-plugin':
        assert report['summary']['importedUnits']==0
        assert any('license metadata and bundled license text' in s['detail'] for s in report['stages'] if s['stage']=='import')
print('Recorded provenance and three successful/four blocked reports verified.')
