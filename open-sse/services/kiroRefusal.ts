const KIRO_DEVELOPER_ROLE_REFUSAL_PATTERNS = [
  /\b(?:my|the)\s+role\s+is\s+(?:only\s+)?(?:a\s+)?developer\b/i,
  /\bi\s*(?:am|'m)\s+(?:only\s+)?(?:a\s+)?developer\b/i,
  /\b(?:can(?:not|'t)|unable to|not able to|can only|only able to)\b[\s\S]{0,160}\b(?:developer|software development|coding)\b/i,
];

export function isKiroDeveloperRoleRefusal(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  return KIRO_DEVELOPER_ROLE_REFUSAL_PATTERNS.some((pattern) => pattern.test(text));
}
