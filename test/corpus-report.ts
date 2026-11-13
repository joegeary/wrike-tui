// Prints how the description corpus opens in the editor: bun test/corpus-report.ts
import { corpusSummary, measureCorpus } from "./support/descriptionCorpus"

console.log(corpusSummary(measureCorpus()))
