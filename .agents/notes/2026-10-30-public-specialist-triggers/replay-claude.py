"""Replay synthetic trigger prompts with process-local plugin loading and read-only tools."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repo', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
repo = args.repo.resolve()
args.out.mkdir(parents=True, exist_ok=False)
cases = json.loads(Path(__file__).with_name('cases.json').read_text())['cases']
records = []
for case in cases:
    trial = args.out / str(case['id'])
    cwd = trial / 'workspace'
    cwd.mkdir(parents=True)
    cmd = ['claude', '--print', '--output-format', 'stream-json', '--verbose',
           '--setting-sources', '', '--no-session-persistence', '--permission-mode', 'dontAsk',
           '--strict-mcp-config', '--tools', 'Skill,Read', '--plugin-dir',
           str(repo / 'plugins/skillset'), '--max-budget-usd', '1', case['prompt']]
    with (trial / 'stdout.jsonl').open('w') as out, (trial / 'stderr.txt').open('w') as err:
        try:
            code = subprocess.run(cmd, cwd=cwd, stdin=subprocess.DEVNULL,
                                  stdout=out, stderr=err, timeout=100).returncode
        except subprocess.TimeoutExpired:
            code = 'timeout'
    records.append({'id': case['id'], 'cwd': str(cwd), 'argv': cmd, 'exit': code})
    (args.out / 'runs.json').write_text(json.dumps(records, indent=2) + '\n')
    print(case['id'], code, flush=True)
paths = sorted(str(p.relative_to(repo)) for p in (repo / 'plugins/skillset').rglob('*') if p.is_file())
(args.out / 'inputs.json').write_text(json.dumps({p: hashlib.sha256((repo / p).read_bytes()).hexdigest()
                                                 for p in paths}, indent=2) + '\n')
