import type { ClientModule } from 'claude-code'

// The key strip of the Todos view: a click gives it the keyboard, then Left and Right post a step to the plugin's
// ui.message hook, which steps the selected to-do as f and p do.
const Arrows: ClientModule<null> = (_props, surface) => {
  const { Text } = surface.elements
  surface.onKey(event => {
    if (event.key === 'left') surface.post({ step: -1 })
    else if (event.key === 'right') surface.post({ step: 1 })
  })
  return <Text dimColor>{'left, right: previous, next status (click here first)'}</Text>
}

export default Arrows
