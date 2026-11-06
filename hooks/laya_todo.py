import json, sys, time

# Lines read Japanese and English objectives; replies are scored by the English checkpoint, which beat the multilingual one on reply statuses.
LINE_MODEL = 'aac6fef/laya-multilingual-mlx'
STATUS_MODEL = 'aac6fef/laya-mlx'
LINE = {'line': {'type': 'choice', 'instructions': 'Is this line an action the assistant should carry out, or only background and context?', 'criteria': ['task', 'background']}}
INSTRUCTIONS = "What does the assistant's reply say about this task: no mention of it, work on it has started, it is finished, or it is refused or dropped?"
STATUS = {'status': {'type': 'choice', 'instructions': INSTRUCTIONS, 'criteria': ['not-mentioned', 'started', 'finished', 'rejected']}}


def status_agent():
    import laya_mlx as laya
    return laya.load(STATUS_MODEL)


def status(agent, item, answer):
    result = agent.predict(f"Task: {item['text']}\nAssistant reply: {answer}", STATUS)['answers']['status']
    return {'label': result['choice'], 'p': result['probabilities'][result['choice']], 'probs': result['probabilities']}


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
        agent = status_agent()
    for item in statuses:
        out['statuses'][item['id']] = status(agent, item, answer)
    out['predictMs'] = round((time.time() - start) * 1000)
    json.dump(out, sys.stdout)


if __name__ == '__main__':
    main()
