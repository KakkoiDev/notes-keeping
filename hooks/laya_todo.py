import json, sys, time

MODEL = 'aac6fef/laya-multilingual-mlx'
LINE = {'line': {'type': 'choice', 'instructions': 'Is this line an action the assistant should carry out, or only background and context?', 'criteria': ['task', 'background']}}
STATUS = {'status': {'type': 'choice', 'instructions': "What does the assistant's reply say about this task: no mention of it, work on it has started, it is finished, or it is refused or dropped?", 'criteria': ['not-mentioned', 'started', 'finished', 'rejected']}}


def main():
    request = json.load(sys.stdin)
    import laya_mlx as laya
    agent = laya.load(MODEL)
    start = time.time()
    out = {'lines': {}, 'statuses': {}}
    for line in request.get('lines', []):
        probabilities = agent.predict(line['text'], LINE)['answers']['line']['probabilities']
        out['lines'][line['id']] = probabilities['task']
    answer = request.get('answer', '')
    for item in request.get('statuses', []) if answer != '' else []:
        result = agent.predict(f"Task: {item['text']}\nAssistant reply: {answer}", STATUS)['answers']['status']
        out['statuses'][item['id']] = {'label': result['choice'], 'p': result['probabilities'][result['choice']]}
    out['predictMs'] = round((time.time() - start) * 1000)
    json.dump(out, sys.stdout)


main()
