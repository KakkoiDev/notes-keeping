import json, math, sys
from collections import Counter
import combine as c
LB = c.LB
import os
KEY = os.environ.get('KEY', 'base')
def distinct_fn(items):
    df = Counter(t for i in items for t in c.tokens(i))
    return lambda item, reply: bool({t for t in c.tokens(item) if df[t] == 1} & c.tokens(reply))
def gate_v2(items):
    return lambda item, reply: c.mentions2(item, reply, items)
def pred_v3(r, gate, items, w=8, floor=0.5):
    p = r[KEY]; men = gate(r['todo'], r['reply'])
    if not men: return 'none'
    k = c.cue3(r['todo'], r['reply'], items)
    sc = {l: math.log(max(p[l], 1e-4)) + (w if l == k else 0) for l in LB}
    tot = sum(math.exp(v) for v in sc.values()); best = max(sc, key=sc.get)
    need = floor if best == k else 0.9
    if best == 'not-mentioned' or math.exp(sc[best]) / tot < need: return 'none'
    return best
def pred_shipped(r, gate, floor=0.6):
    p = r['base']; lab = max(p, key=p.get)
    if lab == 'not-mentioned' or p[lab] < floor or not c.mentions(r['todo'], r['reply']): return 'none'
    return lab
def pred_new(r, gate, w=5, floor=0.0):
    p = r[KEY]; hits = c.cue(r['reply']); men = gate(r['todo'], r['reply'])
    if not men: return 'none'
    sc = {k: math.log(max(p[k], 1e-4)) + (w if k in hits else 0) for k in LB if k != 'not-mentioned'}
    sc['not-mentioned'] = math.log(max(p['not-mentioned'], 1e-4))
    tot = sum(math.exp(v) for v in sc.values()); best = max(sc, key=sc.get)
    if best == 'not-mentioned' or math.exp(sc[best]) / tot < floor: return 'none'
    return best
def score(rows, f):
    ok = wrong = missed = 0
    for r in rows:
        y = 'none' if r['label'] == 'not-mentioned' else r['label']
        p = f(r)
        if p == y: ok += (y != 'none')
        elif p == 'none': missed += 1
        else: wrong += 1
    real = sum(r['label'] != 'not-mentioned' for r in rows)
    return {'right': ok, 'wrong': wrong, 'missed': missed, 'of_moves': real}
if __name__ == '__main__':
    split = sys.argv[2]
    d = json.load(open(sys.argv[1]))
    rows = d[split]['status']
    items = sorted({r['todo'] for r in rows}); g = gate_v2(items) if os.environ.get('GATE') == 'v2' else distinct_fn(items)
    if os.environ.get('CUE') == 'v3':
        print(split, 'v3', score(rows, lambda r: pred_v3(r, g, items)))
    print(split, 'shipped', score(rows, lambda r: pred_shipped(r, g)))
    for w in [3, 5, 8]:
        for fl in [0, 0.5, 0.7, 0.9]:
            print(split, 'new w', w, 'floor', fl, score(rows, lambda r: pred_new(r, g, w, fl)))
