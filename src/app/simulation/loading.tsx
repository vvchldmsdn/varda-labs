import { SimulationLoading } from "@/components/simulation/simulation-loading";
import { SimulationText } from "@/components/simulation/simulation-text";

export default function Loading() {
  return <main className="mx-auto min-h-[70dvh] max-w-6xl px-6 py-12 sm:px-10 sm:py-16">
    <h1 className="varda-page-title"><SimulationText ko="시뮬레이션" en="Simulation" /></h1>
    <SimulationLoading phase="page" />
  </main>;
}
