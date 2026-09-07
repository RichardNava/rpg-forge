export interface AnalysisResourceCleanerPort {
  cleanup(analysisId: string): Promise<void>;
}
