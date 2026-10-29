import json, re, sys, math
from collections import Counter
STOP = set('this that with from have will your should must into also then than when what they them their there here just make been were does done'.split())
def tokens(t):
    t = t.lower()
    w = {x for x in re.findall(r'[a-z0-9][a-z0-9-]{3,}', t) if x not in STOP}
    for run in re.findall(r'[぀-ヿ㐀-鿿]{2,}', t):
        w |= {run[i:i+2] for i in range(len(run)-1)}
    return w
def stem(w): return re.sub(r'y$', 'i', re.sub(r'(ing|ed|es|s)$', '', w))

def tokens2(t):
    t = t.lower()
    w = {stem(x) for x in re.findall(r'[a-z0-9]+', t) if len(x) >= 4 and x not in STOP}
    for run in re.findall(r'[\u3040-\u30ff\u3400-\u9fff]{2,}', t):
        w |= {run[i:i+2] for i in range(len(run)-1)}
    return w
def same(a, b): return a == b or (min(len(a), len(b)) >= 3 and (a.startswith(b) or b.startswith(a)))
def mentions2(item, reply, siblings=()):
    reply_t = tokens2(reply); allt = tokens2(item)
    others = {x for s in siblings if s != item for x in tokens2(s)}
    own = {x for x in allt if not any(same(x, o) for o in others)}
    use = own or allt
    return any(same(x, r) for x in use for r in reply_t)
def mentions(item, reply): return bool(tokens(item) & tokens(reply))
CUES = {
 'finished': r"\b(done|finish\w*|complete[d]?|implemented|landed|committed|fixed|verified|works|pass(es|ed)?)\b|完了|実装し|済み|仕上げ|通りました",
 'started': r"\b(started|starting|working on|partway|partly|half|in the middle|continu\w+|still|more (to do|remains|is open)|not yet)\b|着手|始め|途中|進めて|半分",
 'rejected': r"\b(won't|will not|(was|were|is|are|been|being|be|i|we|got|get) (\w+ )?skipp(ed|ing)|not do|decided against|leav(e|ing) (it )?(out|undone)|out of scope|not something|dropp(ed|ing)|refus\w+|declin\w+)\b|見送|やらない|行わない|手を付けません|範囲外|しません",
}
def cue(reply):
    hits = {k for k, rx in CUES.items() if re.search(rx, reply, re.I)}
    return hits
LB = ['not-mentioned','started','finished','rejected']
def predict(r, key, w, floor):
    p = r[key]
    hits = cue(r['reply']); men = mentions(r['todo'], r['reply'])
    sc = {}
    for k in LB:
        s = math.log(max(p[k], 1e-4))
        if k == 'not-mentioned': s += w * (0 if men else 1)
        else: s += w * (1 if k in hits else 0) - (0 if men else w)
        sc[k] = s
    best = max(sc, key=sc.get)
    return best
def run(rows, key, w):
    return sum(predict(r, key, w, 0) == r['label'] for r in rows), len(rows)
if __name__ == '__main__':
    d = json.load(open(sys.argv[1]))['tune']['status']
    base = sum(max(r['base'], key=r['base'].get) == r['label'] for r in d)
    print('laya only', base, 'rules only', sum(predict({**r,'base':{k:1 for k in LB}},'base',1,0)==r['label'] for r in d), '/', len(d))
    for w in [0,1,2,3,5,8]:
        print('w', w, run(d, 'base', w), run(d, 'dict', w))
    conf = Counter((r['label'], predict(r,'base',3,0)) for r in d)
    print(sorted(conf.items()))

CUES3 = {
 'rejected': r"\b(rejected|won't|will not|not (do|doing|build|building|write|writing|add|adding|worth|something)|(was|were|is|are|been|being|be|i|we|got|get) (\w+ )?skipp(ed|ing)|decided against|leav(e|ing) (it )?(out|undone|as it is)|leav(e|ing) .{0,30} out|out of scope|dropp(ed|ing)|refus\w+|declin\w+)\b|見送|やらない|行わない|手を付けません|範囲外|しません",
 'started': r"\b(started|starting|begun|began|begin|beginning|working on|in progress|under ?way|partway|partly|half|in the middle|continu\w+|still|more (to do|remains|is open)|not (yet|drawn|hooked|connected|wired))\b|着手|始め|途中|進めて|半分",
 'finished': r"\b(done|finish\w*|complete[d]?|implemented|landed|committed|fixed|verified|works|written|added|merged|in and)\b|完了|実装し|済み|仕上げ|通りました",
}
def sentences(t): return [s for s in re.split(r'(?<=[.!?。！？])\s+|\n+|;\s+', t) if s.strip()]
def cue3(item, reply, siblings=()):
    sents = sentences(reply)
    hit = [mentions2(item, s, siblings) for s in sents]
    other = [any(mentions2(o, s, siblings) for o in siblings if o != item) for s in sents]
    # a sentence right after one that names the item carries on about it unless it names another item
    near = [s for i, s in enumerate(sents) if hit[i] or (i > 0 and hit[i-1] and not other[i])]
    toks = {x for x in tokens2(item)}
    def clean(s): return ' '.join(w for w in re.findall(r"[\w']+", s) if len(w) < 4 or not any(same(stem(w.lower()), x) for x in toks))
    text = ' '.join(clean(s) for s in near)
    for k in ['rejected', 'started', 'finished']:
        if re.search(CUES3[k], text, re.I): return k
    return None
