const CORRECTION_PATTERNS = [
  /(不对|不是这样|错了|不应该|不要用|stop|wrong|incorrect)/i,
  /(should be|should use|ought to be|better to use)/i,
  /(不用\w+用|不要\w+要)/i,
];

const PREFERENCE_PATTERNS = [
  /(我喜欢用|prefer|always use|习惯用|i like|i use)/i,
  /(best practice|recommend|建议使用|推荐)/i,
  /(用\w+就好|用\w+就行)/i,
];

const DECISION_PATTERNS = [
  /(选择\s*\w+\s*因为|决定用|choose|decided|migrate|upgrade|downgrade)/i,
  /(use\s+\w+\s+because|migrating\s+(from|to)|switched\s+(from|to))/i,
  /(原因|理由|because|due to|目的是)/i,
];

export interface ClassificationResult {
  matched: boolean;
  patternType: string | null;
  confidence: number;
}

export function detectPreferences(text: string): ClassificationResult | null {
  for (const pattern of CORRECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { matched: true, patternType: 'correction', confidence: 0.7 };
    }
  }
  for (const pattern of PREFERENCE_PATTERNS) {
    if (pattern.test(text)) {
      return { matched: true, patternType: 'preference', confidence: 0.5 };
    }
  }
  for (const pattern of DECISION_PATTERNS) {
    if (pattern.test(text)) {
      return { matched: true, patternType: 'decision', confidence: 0.5 };
    }
  }
  return null;
}
