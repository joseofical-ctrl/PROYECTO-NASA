import MinigameFrame from './MinigameFrame'
import type { MinigameModalProps } from './MinigameFrame'

export default function CiberdefensaSatelitalModal(props: MinigameModalProps) {
  return (
    <MinigameFrame
      {...props}
      game="cyber"
      file="ciberdefensa_satelital.html"
      title="CIBERDEFENSA SATELITAL Y FIREWALL · SERPIENTE-2"
      accent="#a78bfa"
    />
  )
}
