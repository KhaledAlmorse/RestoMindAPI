import { Injectable } from '@nestjs/common';

@Injectable()
export class ArabicNormalizerService {
  normalizeText(text: string): string {
    if (!text) return '';

    let normalized = text.trim();

    // Remove Tatweel (Kashida)
    normalized = normalized.replace(/\u0640/g, '');

    // Normalize Alef variations (أ, إ, آ -> ا)
    normalized = normalized.replace(/[\u0622\u0623\u0625]/g, '\u0627');

    // Normalize Taa Marbouta (ة -> ه)
    normalized = normalized.replace(/\u0629/g, '\u0647');

    // Normalize Yaa (ى -> ي)
    normalized = normalized.replace(/\u0649/g, '\u064A');

    // Remove Harakat (Diacritics)
    normalized = normalized.replace(/[\u064B-\u0652]/g, '');

    return normalized;
  }

  detectLanguage(text: string): 'arabic' | 'english' | 'mixed' {
    const arabicRegex = /[\u0600-\u06FF]/;
    const englishRegex = /[a-zA-Z]/;

    const hasArabic = arabicRegex.test(text);
    const hasEnglish = englishRegex.test(text);

    if (hasArabic && hasEnglish) return 'mixed';
    if (hasArabic) return 'arabic';
    return 'english';
  }
}
