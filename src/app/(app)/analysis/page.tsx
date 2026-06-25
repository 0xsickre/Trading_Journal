import { getBiasAnalyses } from "@/lib/journal/bias";
import { getInstruments } from "@/lib/journal/instruments";
import { BiasAnalysisBoard } from "@/components/journal/bias-analysis";

export default async function AnalysisPage() {
  const [analyses, instruments] = await Promise.all([
    getBiasAnalyses(),
    getInstruments(true),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Analysis</h1>
        <p className="text-muted-foreground">
          Log a directional bias per instrument, set how many weeks it covers,
          then close it Win/Loss — your bias hit-rate at a glance.
        </p>
      </div>

      <BiasAnalysisBoard analyses={analyses} instruments={instruments} />
    </div>
  );
}
