#!/usr/bin/env python3
"""Plants ten defects in a copy of the real translations: python3 plant-defects.py LOCALES_DIR.

The graders name the keys this picks on the translations of 5.11.2026. If those texts change, the picks can move, so
regenerate the graders from the printed list.
"""
import json
import re
import sys

root = sys.argv[1]


def load(language):
    with open(f'{root}/{language}/public.json', encoding='utf-8') as file:
        return json.load(file)


def flat(tree, prefix=''):
    out = {}
    for key, value in tree.items():
        path = f'{prefix}.{key}' if prefix else key
        out.update(flat(value, path) if isinstance(value, dict) else {path: value})
    return out


def put(tree, key, value):
    *parents, last = key.split('.')
    for part in parents:
        tree = tree[part]
    tree[last] = value


en, fr = load('en'), load('fr')
he, flat_en, flat_fr = flat(load('he')), flat(en), flat(fr)
used = []


def pick(texts, test):
    key = next(key for key, value in texts.items() if key not in used and test(key, value))
    used.append(key)
    return key


key = 'r.form.stepper.increase'
put(fr, key, flat_fr[key].replace('{{label}}', '{{libelle}}'))
print('fr', key, 'placeholder renamed')
key = pick(flat_en, lambda k, v: '<contact>' in v and k.startswith('site.'))
put(en, key, flat_en[key].replace('<contact>', '<contacts>').replace('</contact>', '</contacts>'))
print('en', key, 'tag renamed')
del fr['r']['form']['success']['summary_other']
print('fr r.form.success.summary_other plural form removed')
key = pick(flat_en, lambda k, v: re.search(r'\b\d{1,3}\b', v) and len(v) > 60 and k.startswith('site.') and '{{' not in v)
number = re.search(r'\b(\d{1,3})\b', flat_en[key]).group(1)
put(en, key, re.sub(rf'\b{number}\b', str(int(number) + 7), flat_en[key], count=1))
print('en', key, 'number changed')
key = pick(flat_fr, lambda k, v: k.endswith('.answer') and len(v) > 200 and 'invités' in v)
put(fr, key, flat_fr[key].replace('invités', 'מוזמנים', 1))
print('fr', key, 'word left in Hebrew')
key = pick(flat_en, lambda k, v: k.endswith('.answer') and len(v) > 120 and ' not ' in v and re.search(r'(?<![א-ת])לא(?![א-ת])', he.get(k, '')))
put(en, key, flat_en[key].replace(' not ', ' ', 1))
print('en', key, 'negation removed')
key = pick(flat_fr, lambda k, v: k.endswith('.answer') and len(v) > 150 and 'l’événement' in v)
put(fr, key, flat_fr[key].replace('l’événement', 'le événement', 1))
print('fr', key, 'elision removed')
key = pick(flat_en, lambda k, v: k.endswith('.body') and len(v) > 200)
put(en, key, flat_en[key][:len(flat_en[key]) // 2].rsplit(' ', 1)[0] + '.')
print('en', key, 'second half removed')
key = pick(flat_fr, lambda k, v: k.endswith('.body') and len(v) > 120 and ' vos ' in v)
put(fr, key, flat_fr[key].replace(' vos ', ' tes ', 1))
print('fr', key, 'tu form')
key = pick(flat_fr, lambda k, v: k.endswith('.question') and ' ?' in v)
put(fr, key, flat_fr[key].replace(' ?', ' ?', 1))
print('fr', key, 'plain space before ?')

for language, tree in (('en', en), ('fr', fr)):
    with open(f'{root}/{language}/public.json', 'w', encoding='utf-8') as file:
        json.dump(tree, file, ensure_ascii=False, indent=2)
