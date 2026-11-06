# Prompt and input variants tried on bench.py; production (hooks/laya_todo.py) is the v0 variant.
# Flags, joined with +: desc (options described), dict (state as a dict), noul or bin (yes/no questions), update (the
# whole [UPDATE] block as the task), excerpt (only the reply sentences about the item), ins2 (stricter question),
# typed or multi (the typed-decisions or multilingual checkpoint).
import re
from laya_todo import INSTRUCTIONS, LINE_MODEL, STATUS_MODEL

DESC = {'not-mentioned': 'the reply does not talk about this task at all, even if it reports other work',
        'started': 'the reply says work on this task has begun or is partly done, more remains',
        'finished': 'the reply says this task is complete and done',
        'rejected': 'the reply says this task will not be done, refused, skipped or dropped'}
NOUL = {'about': 'Does the assistant reply talk about this specific task?',
        'finished': 'Does the reply say this specific task is completely finished, with nothing left to do?',
        'started': 'Does the reply say work on this specific task has started but is not finished?',
        'rejected': 'Does the reply say this specific task will not be done?'}
STOP = set('this that with from have will your should must into also then than when what they them their there here just make been were does done want would like'.split())


def words(text):
    stem = lambda w: re.sub(r'y$', 'i', re.sub(r'(ing|ed|es|s)$', '', w))
    return {stem(w) for w in re.findall(r'[a-z0-9]+', text.lower()) if len(w) >= 4 and w not in STOP}


# The reply's sentences that share a word only this item has (all its words when it has none of its own),
# and the sentence after each one when that one is about no other item.
def excerpt(item, siblings, answer):
    mine = words(item)
    others = set().union(*[words(s) for s in siblings]) if siblings else set()
    own = (mine - others) or mine
    sentences = [s for s in re.split(r'(?<=[.!?。！？])\s+|\n+|;\s+', answer) if s.strip()]
    about = [bool(own & words(s)) for s in sentences]
    other = [any(words(t) - mine & words(s) for t in siblings) for s in sentences]
    kept = [s for i, s in enumerate(sentences) if about[i] or (i > 0 and about[i - 1] and not other[i])]
    return ' '.join(kept)


def status_agent(FLAGS):
    import laya_mlx as laya
    model = {'typed': 'aac6fef/laya-typed-decisions-mlx', 'multi': LINE_MODEL}
    return laya.load(next((m for k, m in model.items() if k in FLAGS), STATUS_MODEL))


def status(agent, item, answer, FLAGS):
    task = item.get('update') or item['text'] if 'update' in FLAGS else item['text']
    reply = excerpt(item['text'] if 'update' not in FLAGS else task, item.get('siblings', []), answer) if 'excerpt' in FLAGS else answer
    state = {'task': task, 'assistant reply': reply} if 'dict' in FLAGS else f"Task: {task}\nAssistant reply: {reply}"
    if 'bin' in FLAGS:
        ask = lambda q, a, b: agent.predict(state, {'q': {'type': 'choice', 'instructions': q, 'criteria': {'yes': a, 'no': b}}})['answers']['q']['probabilities']['yes']
        about = ask('Does the assistant reply talk about this task?', 'the reply reports on this task', 'the reply is about other work only')
        fin = ask('Does the reply say this task is completely finished?', 'all of the task is done, nothing remains', 'part of it remains, it is only planned, waiting, or not done')
        rej = ask('Does the reply say this task will not be done?', 'the task is refused, skipped, dropped or declined', 'the task is done, started or planned')
        probs = {'not-mentioned': 1 - about, 'started': about * (1 - fin) * (1 - rej), 'finished': about * fin * (1 - rej), 'rejected': about * rej}
        total = sum(probs.values())
        probs = {k: v / total for k, v in probs.items()}
        label = max(probs, key=probs.get)
        return {'label': label, 'p': probs[label], 'probs': probs}
    if 'noul' in FLAGS:
        a = agent.predict(state, {k: {'type': 'noul', 'instructions': q} for k, q in NOUL.items()})['answers']
        y = {k: v['noul'] for k, v in a.items()}
        probs = {'not-mentioned': 1 - y['about'], 'started': y['about'] * y['started'], 'finished': y['about'] * y['finished'], 'rejected': y['about'] * y['rejected']}
        total = sum(probs.values())
        probs = {k: v / total for k, v in probs.items()}
        label = max(probs, key=probs.get)
        return {'label': label, 'p': probs[label], 'probs': probs}
    instructions = INSTRUCTIONS
    if 'ins2' in FLAGS:
        instructions = 'Where does this task stand after the assistant reply? Count it finished only when the reply says all of it is done, not a part, a plan, a draft or a wait.'
    question = {'status': {'type': 'choice', 'instructions': instructions, 'criteria': DESC if 'desc' in FLAGS else list(DESC)}}
    result = agent.predict(state, question)['answers']['status']
    return {'label': result['choice'], 'p': result['probabilities'][result['choice']], 'probs': result['probabilities']}
