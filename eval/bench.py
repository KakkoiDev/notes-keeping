# Laya reply-status bench. Usage: ~/.laya-venv/bin/python bench.py <variant> <tune|heldout> [out.json]
# variant: v0 (hooks/laya_todo.py as shipped) or flags from variants.py joined with +.
# Prints the 4-way accuracy and the close/decline score: every case whose gold or predicted move is finished or rejected.
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'hooks'))
LABELS = ['not-mentioned', 'started', 'finished', 'rejected']
MOVES = ('finished', 'rejected')


def load(name):
    return json.load(open(os.path.join(HERE, name)))


def with_siblings(rows):
    todos = sorted({r['todo'] for r in rows})
    return [{**r, 'siblings': r.get('siblings', [t for t in todos if t != r['todo']])} for r in rows]


# Tuning and held-out sets. The held-out set is only scored, never read case by case while tuning.
def cases(split):
    fx = load('fixtures.json')
    real = load('real.json')
    if split == 'tune':
        return (with_siblings(fx['tune']['status']) + with_siblings(load('extra_tune.json')['tune']['status'])
                + with_siblings(load('held2.json')['heldout2']['status']) + [dict(r, src='real') for r in real['tune']])
    return (with_siblings(fx['heldout']['status']) + with_siblings(load('held3.json')['heldout3']['status'])
            + with_siblings(load('blind.json')['blind']['status']) + [dict(r, src='real') for r in real['heldout']])


def move(probs, threshold):
    label = max(probs, key=probs.get)
    return label if label in MOVES and probs[label] >= threshold else 'open'


def score(rows, threshold):
    gold = lambda r: r['label'] if r['label'] in MOVES else 'open'
    four = sum(max(r['probs'], key=r['probs'].get) == r['label'] for r in rows)
    scope = [r for r in rows if gold(r) != 'open' or move(r['probs'], threshold) != 'open']
    right = [r for r in scope if move(r['probs'], threshold) == gold(r)]
    wrong = [r for r in scope if move(r['probs'], threshold) not in ('open', gold(r))]
    missed = [r for r in scope if move(r['probs'], threshold) == 'open']
    return {'four_way': f'{four}/{len(rows)}', 'close_decline': f'{len(right)}/{len(scope)}', 'wrong_moves': len(wrong), 'missed': len(missed),
            'real': f"{sum(move(r['probs'], threshold) == gold(r) for r in rows if r.get('src') == 'real')}/{sum(r.get('src') == 'real' for r in rows)}"}


def main():
    variant, split = sys.argv[1], sys.argv[2]
    import laya_todo, variants
    flags = set(variant.split('+'))
    rows = cases(split)
    agent = laya_todo.status_agent() if variant == 'v0' else variants.status_agent(flags)
    for r in rows:
        item = {'text': r['todo'], 'update': r.get('update'), 'siblings': r['siblings']}
        r['probs'] = (laya_todo.status(agent, item, r['reply']) if variant == 'v0' else variants.status(agent, item, r['reply'], flags))['probs']
    for threshold in (0.5, 0.7, 0.8, 0.9):
        print(variant, split, f'threshold {threshold}', json.dumps(score(rows, threshold)))
    if len(sys.argv) > 3:
        json.dump(rows, open(sys.argv[3], 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
