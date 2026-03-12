const HANGUL_BASE_CODEPOINT = 0xac00
const HANGUL_LAST_CODEPOINT = 0xd7a3
const HANGUL_N_COUNT = 588
const HANGUL_T_COUNT = 28

const HANGUL_CHOSEONG = [
  'ㄱ',
  'ㄲ',
  'ㄴ',
  'ㄷ',
  'ㄸ',
  'ㄹ',
  'ㅁ',
  'ㅂ',
  'ㅃ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅉ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
] as const

const HANGUL_JUNGSEONG = [
  'ㅏ',
  'ㅐ',
  'ㅑ',
  'ㅒ',
  'ㅓ',
  'ㅔ',
  'ㅕ',
  'ㅖ',
  'ㅗ',
  'ㅘ',
  'ㅙ',
  'ㅚ',
  'ㅛ',
  'ㅜ',
  'ㅝ',
  'ㅞ',
  'ㅟ',
  'ㅠ',
  'ㅡ',
  'ㅢ',
  'ㅣ',
] as const

const HANGUL_JONGSEONG = [
  '',
  'ㄱ',
  'ㄲ',
  'ㄳ',
  'ㄴ',
  'ㄵ',
  'ㄶ',
  'ㄷ',
  'ㄹ',
  'ㄺ',
  'ㄻ',
  'ㄼ',
  'ㄽ',
  'ㄾ',
  'ㄿ',
  'ㅀ',
  'ㅁ',
  'ㅂ',
  'ㅄ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
] as const

const JAMO_TO_2BEOLSIK: Record<string, string> = {
  ㄱ: 'r',
  ㄲ: 'R',
  ㄳ: 'rt',
  ㄴ: 's',
  ㄵ: 'sw',
  ㄶ: 'sg',
  ㄷ: 'e',
  ㄸ: 'E',
  ㄹ: 'f',
  ㄺ: 'fr',
  ㄻ: 'fa',
  ㄼ: 'fq',
  ㄽ: 'ft',
  ㄾ: 'fx',
  ㄿ: 'fv',
  ㅀ: 'fg',
  ㅁ: 'a',
  ㅂ: 'q',
  ㅃ: 'Q',
  ㅄ: 'qt',
  ㅅ: 't',
  ㅆ: 'T',
  ㅇ: 'd',
  ㅈ: 'w',
  ㅉ: 'W',
  ㅊ: 'c',
  ㅋ: 'z',
  ㅌ: 'x',
  ㅍ: 'v',
  ㅎ: 'g',
  ㅏ: 'k',
  ㅐ: 'o',
  ㅑ: 'i',
  ㅒ: 'O',
  ㅓ: 'j',
  ㅔ: 'p',
  ㅕ: 'u',
  ㅖ: 'P',
  ㅗ: 'h',
  ㅘ: 'hk',
  ㅙ: 'ho',
  ㅚ: 'hl',
  ㅛ: 'y',
  ㅜ: 'n',
  ㅝ: 'nj',
  ㅞ: 'np',
  ㅟ: 'nl',
  ㅠ: 'b',
  ㅡ: 'm',
  ㅢ: 'ml',
  ㅣ: 'l',
}

export function convertHangulTo2Beolsik(text: string): { sequence: string; hasHangul: boolean } {
  const chunks: string[] = []
  let hasHangul = false

  for (const char of text) {
    const codepoint = char.codePointAt(0) ?? 0
    if (codepoint >= HANGUL_BASE_CODEPOINT && codepoint <= HANGUL_LAST_CODEPOINT) {
      const syllableIndex = codepoint - HANGUL_BASE_CODEPOINT
      const choseongIndex = Math.floor(syllableIndex / HANGUL_N_COUNT)
      const jungseongIndex = Math.floor((syllableIndex % HANGUL_N_COUNT) / HANGUL_T_COUNT)
      const jongseongIndex = syllableIndex % HANGUL_T_COUNT

      const choseong = HANGUL_CHOSEONG[choseongIndex]
      const jungseong = HANGUL_JUNGSEONG[jungseongIndex]
      chunks.push(JAMO_TO_2BEOLSIK[choseong], JAMO_TO_2BEOLSIK[jungseong])

      const jongseong = HANGUL_JONGSEONG[jongseongIndex]
      if (jongseong) chunks.push(JAMO_TO_2BEOLSIK[jongseong])
      hasHangul = true
      continue
    }

    const mapped = JAMO_TO_2BEOLSIK[char]
    if (mapped) {
      chunks.push(mapped)
      hasHangul = true
      continue
    }

    chunks.push(char)
  }

  return { sequence: chunks.join(''), hasHangul }
}

export function getKoreanTypingHint(text: string): string {
  const { sequence, hasHangul } = convertHangulTo2Beolsik(text)
  return hasHangul ? sequence : ''
}

