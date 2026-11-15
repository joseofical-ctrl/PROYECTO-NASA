import MinigameFrame from './MinigameFrame'
import type { MinigameModalProps } from './MinigameFrame'

export default function AterrizajePlanetarioModal(props: MinigameModalProps) {
  return (
    <MinigameFrame
      {...props}
      game="lander"
      file="aterrizaje_planetario.html"
      title="ATERRIZAJE PLANETARIO DE SONDA CIENTÍFICA · PUMA-3"
      accent="#55efc4"
    />
  )
}
