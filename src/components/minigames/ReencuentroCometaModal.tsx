import MinigameFrame from './MinigameFrame'
import type { MinigameModalProps } from './MinigameFrame'

export default function ReencuentroCometaModal(props: MinigameModalProps) {
  return (
    <MinigameFrame
      {...props}
      game="comet"
      file="reencuentro_cometa.html"
      title="DEFENSA ORBITAL CONTRA METEORITOS · CÓNDOR-4"
      accent="#f87171"
    />
  )
}
