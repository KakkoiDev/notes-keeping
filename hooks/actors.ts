// Who can act on a notes file. Laya runs aac6fef/laya-mlx on replies and aac6fef/laya-multilingual-mlx on objective lines.
// Every row of its # Logs section names exactly one of these ids. A file change the plugin
// did not make and cannot attribute is `unknown`, never the captain.
export const ACTORS = [
  { id: 'captain', kind: 'human', label: 'Captain (human)' },
  { id: 'firstmate', kind: 'ai-agent', label: 'Firstmate (AI agent, Claude Opus 5.5 via bridge)' },
  { id: 'laya', kind: 'ai-agent', label: 'Laya (AI classifier, aac6fef/laya-mlx)' },
  { id: 'plugin', kind: 'plugin', label: 'Plugin (notes-keeping)' },
  { id: 'unknown', kind: 'unknown', label: 'Unknown writer' },
] as const

export type ActorId = (typeof ACTORS)[number]['id']

export function actorLabel(id: string): string {
  return ACTORS.find(actor => actor.id === id)?.label ?? id
}
