import MinigameFrame from './MinigameFrame'
import type { MinigameModalProps } from './MinigameFrame'

export default function ReparacionTelecomModal(props: MinigameModalProps) {
  return (
    <MinigameFrame
      {...props}
      game="telecom"
      file="reparacion_telecom.html"
      title="DSN TELECOMMUNICATIONS TUNING · SERPIENTE-2"
      accent="#67e8f9"
    />
  )
}
