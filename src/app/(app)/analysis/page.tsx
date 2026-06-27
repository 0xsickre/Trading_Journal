import {
  getBiasAnalyses,
  getMarketContexts,
  getCotLegs,
} from "@/lib/journal/bias";
import { getInstruments } from "@/lib/journal/instruments";
import { getOptionsMap } from "@/lib/journal/options";
import { BiasAnalysisBoard } from "@/components/journal/bias-analysis";

export default async function AnalysisPage() {
  const [analyses, contexts, legs, instruments, optionsMap] = await Promise.all(
    [
      getBiasAnalyses(),
      getMarketContexts(),
      getCotLegs(),
      getInstruments(true),
      getOptionsMap(true),
    ],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Analysis</h1>
        <p className="text-muted-foreground">
          Set the week&apos;s global context and per-currency COT once, then log
          a directional bias per instrument — shared data is reused, never
          retyped.
        </p>
      </div>

      <BiasAnalysisBoard
        analyses={analyses}
        contexts={contexts}
        legs={legs}
        instruments={instruments}
        optionsMap={optionsMap}
      />
    </div>
  );
}
