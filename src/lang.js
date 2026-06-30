import { createContext, useContext, useState } from 'react';

export const LangContext = createContext(null);

export function useLangState() {
  const [lang, setLang] = useState('es');
  const t = (entry) => (lang === 'es' ? entry.es : entry.en ?? entry.es);
  return { lang, setLang, t };
}

export function useLang() {
  return useContext(LangContext);
}
