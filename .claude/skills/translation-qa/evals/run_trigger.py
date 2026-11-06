#!/usr/bin/env python3
"""Activation test for the installed skill, under real conditions.

skill-creator's run_eval.py adds a temporary copy of the skill and watches for that copy. Here the installed translation-qa
would compete with the copy, so a correct choice of the real skill would count as a miss. This runner watches for the real
skill instead. Each child has only the Skill tool, no hooks and no MCP, and keeps no session, so it can't change anything.
"""
import json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
ROOT = '/var/www/vhosts/kalfa.me/beta'
TARGET = 'translation-qa'
def run_one(item, run_index, timeout, model):
    cmd = ['claude', '-p', item['query'], '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
           '--tools', 'Skill', '--strict-mcp-config', '--no-session-persistence',
           '--settings', json.dumps({'disableAllHooks': True}), '--model', model]
    env = {k: v for k, v in os.environ.items() if k != 'CLAUDECODE'}
    start = time.time()
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=ROOT, env=env, text=True)
    skill, text = None, ''
    try:
        for line in process.stdout:
            if time.time() - start > timeout: break
            try: event = json.loads(line)
            except json.JSONDecodeError: continue
            if event.get('type') == 'assistant':
                for block in event.get('message', {}).get('content', []):
                    if block.get('type') == 'tool_use' and block.get('name') == 'Skill':
                        skill = block.get('input', {}).get('skill')
                    elif block.get('type') == 'text': text += block.get('text', '')
                if skill: break
            if event.get('type') == 'result': break
    finally:
        if process.poll() is None:
            process.kill(); process.wait()
    return {'query': item['query'], 'should_trigger': item['should_trigger'], 'run': run_index, 'skill': skill,
            'triggered': skill is not None and skill.split(':')[-1] == TARGET, 'seconds': round(time.time() - start, 1), 'text': text[:120]}
def main():
    queries = json.load(open(sys.argv[1], encoding='utf-8'))
    runs, workers, timeout = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    model = sys.argv[5] if len(sys.argv) > 5 else 'claude-opus-5-5'
    jobs = [(item, index) for item in queries for index in range(runs)]
    with ThreadPoolExecutor(workers) as pool:
        results = list(pool.map(lambda job: run_one(job[0], job[1], timeout, model), jobs))
    correct = sum(result['triggered'] == result['should_trigger'] for result in results)
    print(json.dumps({'correct': correct, 'total': len(results), 'results': results}, ensure_ascii=False, indent=1))
if __name__ == '__main__': main()
