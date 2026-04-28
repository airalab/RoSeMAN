const CIDV0_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CIDV1_RE = /^b[a-z2-7]{58,}$/i;

export function isIpfsCid(value: string): boolean {
  return CIDV0_RE.test(value) || CIDV1_RE.test(value);
}
