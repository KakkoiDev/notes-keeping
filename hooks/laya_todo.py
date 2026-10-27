import json, sys, time

# Lines read Japanese and English objectives; replies are scored by the English checkpoint, which beat the multilingual one on reply statuses.
LINE_MODEL = 'aac6fef/laya-multilingual-mlx'
STATUS_MODEL = 'aac6fef/laya-mlx'
LINE = {'line': {'type': 'choice', 'instructions': 'Is this line an action the assistant should carry out, or only background and context?', 'criteria': ['task', 'background']}}
STATUS = {'status': {'type': 'choice', 'instructions': "What does the assistant's reply say about this task: no mention of it, work on it has started, it is finished, or it is refused or dropped?", 'criteria': ['not-mentioned', 'started', 'finished', 'rejected']}}


def main():
    request = json.load(sys.stdin)
    import laya_mlx as laya
    start = time.time()
    out = {'lines': {}, 'statuses': {}}
    lines = request.get('lines', [])
    if lines:
        agent = laya.load(LINE_MODEL)
        for line in lines:
            probabilities = agent.predict(line['text'], LINE)['answers']['line']['probabilities']
            out['lines'][line['id']] = probabilities['task']
    answer = request.get('answer', '')
    statuses = request.get('statuses', []) if answer != '' else []
    if statuses:
        agent = laya.load(STATUS_MODEL)
    for item in statuses:
        result = agent.predict(f"Task: {item['text']}\nAssistant reply: {answer}", STATUS)['answers']['status']
        out['statuses'][item['id']] = {'label': result['choice'], 'p': result['probabilities'][result['choice']], 'probs': result['probabilities']}
    out['predictMs'] = round((time.time() - start) * 1000)
    json.dump(out, sys.stdout)


main()
