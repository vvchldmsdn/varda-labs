import { SimulationLoading } from "@/components/simulation/simulation-loading";
import { SimulationText } from "@/components/simulation/simulation-text";
import { PageTitle as CairnPageTitle } from "@/components/cairn-ui";


export default function Loading() {
  return <main className="mx-auto min-h-[70dvh] max-w-6xl px-6 py-12 sm:px-10 sm:py-16">
    <CairnPageTitle className="varda-page-title"><SimulationText ko="시뮬레이션" en="Simulation" /></CairnPageTitle>
    <SimulationLoading phase="page" />
  </main>;
}
