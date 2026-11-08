#!/usr/bin/env python3
"""Download PokeAPI evolution chains for species playable in PokéSurvivor.

    python tools/fetch_evolutions.py
    python tools/fetch_evolutions.py --check
"""
import concurrent.futures
import json
import os
import re
import sys
import urllib.request

API = 'https://pokeapi.co/api/v2'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEX_FILE = os.path.join(ROOT, 'js', 'data', 'pokedex.js')
OUT_FILE = os.path.join(ROOT, 'js', 'data', 'evolutions.js')
HEADERS = {'User-Agent': 'pokesurvivor/1.0'}


def get_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=40) as response:
        return json.load(response)


def playable_dexes():
    with open(DEX_FILE, encoding='utf-8') as source:
        return {int(dex) for dex in re.findall(r'"dex":(\d+)', source.read())}


def species_dex(url):
    match = re.search(r'/pokemon-species/(\d+)/?$', url)
    return int(match.group(1)) if match else None


def walk_chain(node, out, playable):
    source_species = node['species']['name']
    source = species_dex(node['species']['url'])
    for child in node.get('evolves_to', []):
        target_species = child['species']['name']
        target = species_dex(child['species']['url'])
        if source in playable and target in playable:
            details = child.get('evolution_details') or [{}]
            for detail in details:
                required = detail.get('required_pokemon_form')
                evolved = detail.get('evolved_pokemon_form')
                if required and required['name'] != source_species:
                    continue
                if evolved and evolved['name'] != target_species:
                    continue
                trigger = (detail.get('trigger') or {}).get('name')
                level = detail.get('min_level') or (16 if trigger == 'level-up' else 20)
                key = (source, target)
                out[key] = min(out.get(key, level), level)
        walk_chain(child, out, playable)


def fetch_all():
    playable = playable_dexes()
    index = get_json(f'{API}/evolution-chain?limit=2000')
    urls = [row['url'] for row in index['results']]
    edges = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for i, chain in enumerate(pool.map(get_json, urls), 1):
            walk_chain(chain['chain'], edges, playable)
            if i % 100 == 0 or i == len(urls):
                print(f'  {i}/{len(urls)} cadenas')
    return edges


def write(edges):
    by_dex = {}
    for source, target, level in edges:
        by_dex.setdefault(source, []).append({'dex': target, 'level': level})
    lines = [
        '/* ============ evolutions.js — GENERADO desde PokeAPI ============ */',
        'G.POKEMON_EVO = ' + json.dumps(by_dex, separators=(',', ':')) + ';',
        '',
    ]
    with open(OUT_FILE, 'w', encoding='utf-8', newline='\n') as output:
        output.write('\n'.join(lines))


def main():
    if '--check' in sys.argv:
        sample = get_json(f'{API}/evolution-chain/1')
        edges = {}
        walk_chain(sample['chain'], edges, playable_dexes())
        assert edges[(1, 2)] == 16 and edges[(2, 3)] == 32, edges
        print('ok: la cadena de Bulbasaur produce Ivysaur (16) y Venusaur (32)')
        return
    edges = fetch_all()
    write((source, target, level) for (source, target), level in edges.items())
    print(f'{len(edges)} evoluciones escritas en js/data/evolutions.js')


if __name__ == '__main__':
    main()