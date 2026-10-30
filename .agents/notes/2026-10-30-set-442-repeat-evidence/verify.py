"""Verify retained repeated captures without extraction or execution."""
from pathlib import Path
import hashlib,json,tarfile
ROOT=Path(__file__).resolve().parent

def digest(data): return hashlib.sha256(data).hexdigest()
def archive(path):
    with tarfile.open(path) as tar:
        members=tar.getmembers(); names=[m.name for m in members]
        assert len(names)==len(set(names))
        assert all(not Path(n).is_absolute() and '..' not in Path(n).parts for n in names)
        return {m.name:tar.extractfile(m).read() for m in members if m.isfile() and not any(p.startswith('._') for p in Path(m.name).parts)}
def differences(a,b,path=''):
    if type(a)!=type(b): return [[path,a,b]]
    if isinstance(a,dict): return [d for k in sorted(a.keys()|b.keys()) for d in differences(a.get(k),b.get(k),path+'/'+k)]
    if isinstance(a,list): return [d for i in range(max(len(a),len(b))) for d in differences(a[i] if i<len(a) else None,b[i] if i<len(b) else None,path+'/'+str(i))]
    return [] if a==b else [[path,a,b]]
for path,expected in json.loads((ROOT/'sha256.json').read_text()).items():assert digest((ROOT/path).read_bytes())==expected,path
raw=archive(ROOT/'captures.tar.xz')
a={p[2:]:v for p,v in raw.items() if p.startswith('a/')};b={p[2:]:v for p,v in raw.items() if p.startswith('b/')}
assert a.keys()==b.keys()
prov=json.loads(a['provenance.json']); assert a['provenance.json']==b['provenance.json']
assert prov['codeSHA']=='4cce9e60c3c0dc740d6a57a8482914d4d56e1c10'
historical=archive(ROOT.parent/'2026-10-30-set-433-external-evidence'/'raw-captures.tar.xz')
assert prov['entries']==json.loads(historical['set433-external-8a5d-a/provenance.json'])['entries']
refs=json.loads((ROOT/'original-refs.json').read_text());assert len(refs)==14
for e in prov['entries']:
    n=e['name'];expected=digest(historical[f'set433-external-8a5d-a/{n}/original.tar'])
    assert refs[f'a/{n}/original.tar']==refs[f'b/{n}/original.tar']==expected
projection=[p for p in a if '/projection-' in p];assert len(projection)==115 and all(a[p]==b[p] for p in projection)
changed=sorted(p for p in a if a[p]!=b[p]);summary=json.loads((ROOT/'comparison.json').read_text())
assert changed==summary['changedRawPaths']
report_diff={};timestamp_paths=[]
for path in changed:
    x=json.loads(a[path]);y=json.loads(b[path]);delta=differences(x,y)
    if path.endswith('/.skillset/changes/state.json'):
        assert delta and all(d[0].endswith('/updatedAt') for d in delta),path
        timestamp_paths.append(path)
    else:
        assert path.endswith('/raw-report.json')
        assert len(delta)==1 and delta[0][0]=='/report/stages/4/detail'
        assert x['report']['stages'][4]['stage']==y['report']['stages'][4]['stage']=='build'
        report_diff[path.split('/')[0]]=delta
assert timestamp_paths==summary['stateTimestampOnlyPaths'] and len(timestamp_paths)==6
assert report_diff==json.loads((ROOT/'report-diff.json').read_text()) and len(report_diff)==5
success=[];blocked=[]
for e in prov['entries']:
    n=e['name'];report=json.loads(a[f'{n}/raw-report.json'])['report']
    (success if report['ok'] else blocked).append(n)
    for run in (a,b):
        status=run[f'{n}/source-status.txt'].decode().splitlines()
        assert all(s[3:]=='skillset.yaml' or s[3:].startswith('.skillset/') for s in status),(n,status)
    if not report['ok']:assert not report['roundTrips']
assert len(success)==3 and len(blocked)==4
print(json.dumps({'projectionFiles':len(projection),'projectionBytesEqual':True,'rawTimestampDifferences':len(timestamp_paths),'reportWriteCountDifferences':len(report_diff),'successful':success,'blocked':blocked},indent=2))
