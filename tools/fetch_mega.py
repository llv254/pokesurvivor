#!/usr/bin/env python3
"""Download Mega/Primal data and animated forms from PokeAPI and SpriteCollab.

    python tools/fetch_mega.py --check
    python tools/fetch_mega.py
"""
import concurrent.futures
import json
import os
import re
import sys
import urllib.error
import urllib.request

from fetch_sprites import BASE, OUT_ASSETS, RAW, REQUIRED, download_set, fetch, parse_animdata

API = 'https://pokeapi.co/api/v2'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEX_FILE = os.path.join(ROOT, 'js', 'data', 'pokedex.js')
OUT_FILE = os.path.join(ROOT, 'js', 'data', 'mega.js')


def get_json(url, retries=3):
    last = None
    for _ in range(retries):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'pokesurvivor/1.0'})
            with urllib.request.urlopen(request, timeout=40) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            last = error
        except Exception as error:
            last = error
    raise RuntimeError(f'{url}: {last}')


def playable_dexes():
    with open(DEX_FILE, encoding='utf-8') as source:
        return {int(dex) for dex in re.findall(r'"dex":(\d+)', source.read())}


def subgroup_map(node, path=()):
    found = []
    for code, group in (node or {}).items():
        current = path + (code,)
        name = group.get('name', '')
        if re.fullmatch(r'Mega(?:_[XYZ])?|Primal', name):
            found.append((name, current, group))
        found.extend(subgroup_map(group.get('subgroups'), current))
    return found


def form_key(name):
    if name.startswith(('tatsugiri-droopy-', 'tatsugiri-stretchy-')):
        return ''
    if name.endswith('-primal'):
        return 'primal'
    for suffix in ('mega-x', 'mega-y', 'mega-z'):
        if name.endswith('-' + suffix):
            return suffix
    if '-mega' in name:
        tail = name.rsplit('-mega', 1)[1].strip('-')
        return 'mega-' + tail if tail else 'mega'
    return ''


def group_name(form):
    if form == 'primal':
        return 'Primal'
    if form in ('mega-x', 'mega-y', 'mega-z'):
        return 'Mega_' + form[-1].upper()
    return 'Mega'


def find_shiny(group):
    for code, child in (group.get('subgroups') or {}).items():
        if child.get('name') == 'Shiny':
            return code, child
    return None, None


def game_stats(pokemon):
    base = {row['stat']['name']: row['base_stat'] for row in pokemon['stats']}
    return {
        'hp': round(70 + base['hp'] * 0.45),
        'spd': round(78 + base['speed'] * 0.42),
        'atk': round(0.70 + max(base['attack'], base['special-attack']) / 100 * 0.55, 2),
        'pa': round(0.70 + base['attack'] / 100 * 0.55, 2),
        'sa': round(0.70 + base['special-attack'] / 100 * 0.55, 2),
        'df': base['defense'],
        'sd': base['special-defense'],
        'types': [row['type']['name'] for row in pokemon['types']],
    }


def form_record(name, tracker, playable):
    pokemon = get_json(f'{API}/pokemon/{name}')
    if not pokemon:
        return None
    dex = int(re.search(r'/pokemon-species/(\d+)/?$', pokemon['species']['url']).group(1))
    form = form_key(name)
    if dex not in playable or not form:
        return None
    wanted = group_name(form)
    matches = [row for row in subgroup_map(tracker[f'{dex:04d}'].get('subgroups')) if row[0] == wanted]
    match = next((row for row in matches if REQUIRED <= set(row[2].get('sprite_files', {}))), None)
    if not match:
        return None
    _, path, group = match
    return {
        'dex': dex, 'id': form, 'name': name,
        'stats': game_stats(pokemon), 'path': path, 'group': group,
    }


def mega_check():
    assert form_key('tatsugiri-curly-mega') == 'mega'
    assert not form_key('tatsugiri-droopy-mega')
    assert not form_key('tatsugiri-stretchy-mega')
    tracker = get_json(RAW + '/tracker.json')
    record = form_record('charizard-mega-x', tracker, playable_dexes())
    assert record and record['dex'] == 6 and record['id'] == 'mega-x', record
    url = BASE + '/' + '/'.join((f'{record["dex"]:04d}', *record['path']))
    xml = fetch(url + '/AnimData.xml')
    assert xml, url
    anims, _ = parse_animdata(xml.decode('utf-8', 'replace'))
    assert REQUIRED <= set(anims), anims
    assert record['stats']['atk'] > 1.4 and 'dragon' in record['stats']['types'], record['stats']
    print('ok: Charizard Mega X tiene datos PokeAPI, grupo de sprites y animaciones')


def write(records, sprite_meta):
    forms = {}
    for record in records:
        clean = {key: record[key] for key in ('id', 'name', 'stats')}
        forms.setdefault(record['dex'], []).append(clean)
    lines = [
        '/* ============ mega.js — GENERADO desde PokeAPI y SpriteCollab ============ */',
        'G.MEGA_FORMS = ' + json.dumps(forms, separators=(',', ':')) + ';',
        'G.MEGA_SPRITE_META = ' + json.dumps(sprite_meta, separators=(',', ':')) + ';',
        '',
    ]
    with open(OUT_FILE, 'w', encoding='utf-8', newline='\n') as output:
        output.write('\n'.join(lines))


def main():
    if '--check' in sys.argv:
        mega_check()
        return
    tracker = get_json(RAW + '/tracker.json')
    index = get_json(f'{API}/pokemon?limit=2000')
    names = [row['name'] for row in index['results']
             if '-mega' in row['name'] or row['name'].endswith('-primal')]
    playable = playable_dexes()
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        records = [row for row in pool.map(lambda name: form_record(name, tracker, playable), names) if row]

    sprite_meta = {}
    saved = []
    for index, record in enumerate(records, 1):
        dex, form, path = record['dex'], record['id'], record['path']
        root = BASE + '/' + '/'.join((f'{dex:04d}', *path))
        xml = fetch(root + '/AnimData.xml')
        if not xml:
            continue
        anims, shadow = parse_animdata(xml.decode('utf-8', 'replace'))
        folder = os.path.join(OUT_ASSETS, str(dex), 'f-' + form)
        normal = download_set(root, folder, anims)
        if not REQUIRED <= set(normal):
            continue
        meta = {'s': shadow, 'a': normal}
        shiny_code, shiny_group = find_shiny(record['group'])
        if shiny_code and REQUIRED <= set(shiny_group.get('sprite_files', {})):
            shiny_root = root + '/' + shiny_code
            shiny_xml = fetch(shiny_root + '/AnimData.xml')
            shiny_anims = parse_animdata(shiny_xml.decode('utf-8', 'replace'))[0] if shiny_xml else anims
            shiny = download_set(shiny_root, os.path.join(folder, 's'), shiny_anims, normal)
            if REQUIRED <= set(shiny):
                meta['sh'] = 1
                diff = {key: value for key, value in shiny.items() if normal.get(key) != value}
                if diff:
                    meta['sa'] = diff
                missing = [key for key in normal if key not in shiny]
                if missing:
                    meta['sm'] = missing
        sprite_meta.setdefault(str(dex), {})[form] = meta
        saved.append({**record, 'sprite_meta': meta})
        if index % 10 == 0 or index == len(records):
            print(f'  {index}/{len(records)} Mega/Primal')

    # Keep only forms whose animations were downloaded successfully.
    write(saved, sprite_meta)
    size = sum(os.path.getsize(os.path.join(dp, name)) for dp, _, files in os.walk(OUT_ASSETS) for name in files)
    print(f'{len(saved)} forms Mega/Primal in js/data/mega.js; sprite tree {size / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
