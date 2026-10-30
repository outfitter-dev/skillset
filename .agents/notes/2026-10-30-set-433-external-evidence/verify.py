"""Verify retained evidence without extraction, network, or provider execution."""
from pathlib import Path
import hashlib
import io
import json
import tarfile

ROOT = Path(__file__).resolve().parent

def digest(data):
    return hashlib.sha256(data).hexdigest()

def archive(name):
    with tarfile.open(ROOT / name) as tar:
        return {item.name: tar.extractfile(item).read()
                for item in tar if item.isfile() and not any(part.startswith('._') for part in Path(item.name).parts)}

def projections(files, prefix):
    return {path.removeprefix(prefix): data for path, data in files.items()
            if path.startswith(prefix) and '/projection-0/' in path}

checksums = json.loads((ROOT / 'sha256.json').read_text())
for path, expected in checksums.items():
    assert digest((ROOT / path).read_bytes()) == expected, path
before_files = archive('before-capture.tar.xz')
after_files = archive('raw-captures.tar.xz')
assert digest((ROOT / 'fixture-manifest.yaml').read_bytes()) == '18086bcdd282790fa62ac1215d366dd1ce370312821df27e0226f9e2e6439814'
assert json.loads(before_files['fidelity-before-complete/provenance.json'])['codeSHA'] == '364f7235b1bedab3a6543af4f641e95ff1c1bcb8'
for repeat in ('a', 'b', 'c'):
    provenance = json.loads(after_files[f'set433-external-8a5d-{repeat}/provenance.json'])
    assert provenance['codeSHA'] == '8a5d5b282ade4f5aa2fa8e506fe1297890bce037'
    assert provenance['manifestSha256'] == digest((ROOT / 'fixture-manifest.yaml').read_bytes())
before = projections(before_files, 'fidelity-before-complete/')
after = projections(after_files, 'set433-external-8a5d-a/')
for repeat in ('b', 'c'):
    assert after == projections(after_files, f'set433-external-8a5d-{repeat}/'), repeat
same = {path for path in before.keys() & after.keys() if before[path] == after[path]}
changed = sorted(path for path in before.keys() & after.keys() if before[path] != after[path])
added = sorted(after.keys() - before.keys())
removed = sorted(before.keys() - after.keys())
assert (len(before), len(after), len(same), len(changed), len(added), len(removed)) == (87,88,83,4,1,0)
manifest = json.loads((ROOT / 'semantic-unchanged-artifacts.json').read_text())
assert len(manifest['items']) == 83
assert {f"{row['fixture']}/projection-0/{row['output']}" for row in manifest['items']} == same
trees = {}
for entry in json.loads((ROOT / 'git-trees.json').read_text())['entries']:
    assert digest(entry['output'].encode()) == entry['output_sha256']
    trees[entry['fixture']] = {line.split('\t',1)[1]: line.split(' ',1)[0]
                               for line in entry['output'].splitlines()}
originals = {}
for row in manifest['items']:
    fixture = row['fixture']
    path = f"{fixture}/projection-0/{row['output']}"
    assert digest(after[path]) == row['output_sha256'], path
    if fixture not in originals:
        with tarfile.open(fileobj=io.BytesIO(after_files[f'set433-external-8a5d-a/{fixture}/original.tar'])) as tar:
            originals[fixture] = {m.name: tar.extractfile(m).read() for m in tar if m.isfile()}
    if row.get('source_git_mode'):
        assert trees[fixture][row['source_path']] == row['source_git_mode']
    if row.get('source_path'):
        source = originals[fixture][row['source_path']]
        assert digest(source) == row['source_sha256'], row['source_path']
        if row['bytes_equal_original'] is True:
            assert source == after[path], path
for fixture, source_root in (('browserbase-claude-code-plugin', ''), ('claude-review-loop', 'plugins/review-loop/')):
    path = f'{fixture}/projection-0/hooks/hooks.json'
    assert after[path] == originals[fixture][source_root + 'hooks/hooks.json']
    assert json.loads(before[path]) == json.loads(after[path])
assert after['claude-review-loop/projection-0/hooks/stop-hook.sh'] == originals['claude-review-loop']['plugins/review-loop/hooks/stop-hook.sh']
print(json.dumps({'before':len(before),'after':len(after),'unchanged':len(same),
                  'changed':changed,'added':added,'removed':removed,
                  'repeat_projection_bytes':'A=B=C','source_mappings':len(manifest['items'])},indent=2))
