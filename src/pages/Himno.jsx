import { useEffect, useRef, useState } from 'react';
import RiverMeander from '../assets/RiverMeander.jsx';
import { useLang } from '../lang.js';

const VERSES_ES = [
  {
    title: 'Verso 1',
    lines: [
      'Desde la orilla del río marrón,',
      'donde el trabajo nos dio el corazón,',
      'nacimos del barro, del hierro y la sal,',
      'los hijos del puerto, la gente leal.',
    ],
  },
  {
    title: 'Estribillo',
    lines: [
      '¡Vamos, Riachuelo, la voz del andén!',
      'No somos la marca, ¡somos la fe!',
      'Oh-oh-oh-oh, la orilla cantó,',
      'mientras haya neblina, ¡no muere el amor!',
    ],
  },
  {
    title: 'Verso 2',
    lines: [
      'Genoveses vinieron con sueños de mar,',
      'chapa y madera nos vieron luchar,',
      'no se compra el aguante, no se vende el honor,',
      'la camiseta se gana con sudor.',
    ],
  },
  { title: '(Repite estribillo)', lines: [] },
  {
    title: 'Puente / chant',
    lines: ['¡Oh, Riachuelo! ¡Oh-oh-oh!', 'de La Boca soy, donde el río me vio.'],
  },
];

const VERSES_EN = [
  {
    title: 'Verse 1',
    lines: [
      'From the bank of the brown river,',
      'where work gave us our heart,',
      'we were born of mud, of iron and salt,',
      'the children of the port, the loyal ones.',
    ],
  },
  {
    title: 'Chorus',
    lines: [
      'Come on, Riachuelo, the voice of the platform!',
      "We're not the brand, we're the faith!",
      'Oh-oh-oh-oh, the riverbank sang,',
      'as long as there is mist, love does not die!',
    ],
  },
  {
    title: 'Verse 2',
    lines: [
      'Genoese came with dreams of the sea,',
      'tin and crate-wood watched us fight,',
      'loyalty isn’t bought, honour isn’t sold,',
      'the shirt is earned with sweat.',
    ],
  },
  { title: '(Repeat chorus)', lines: [] },
  {
    title: 'Bridge / chant',
    lines: ['Oh, Riachuelo! Oh-oh-oh!', 'I am of La Boca, where the river saw me born.'],
  },
];

const CHANT = {
  es: ['¡Vamos, Riachuelo, la voz del andén!', 'No somos la marca, ¡somos la fe!'],
  en: ["Come on, Riachuelo, the voice of the platform!", "We're not the brand, we're the faith!"],
};

export default function Himno() {
  const { t, lang } = useLang();
  const audioRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    const onEnd = () => setPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play();
      setPlaying(true);
    }
  };

  const seek = (e) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * audio.duration;
  };

  const verses = lang === 'es' ? VERSES_ES : VERSES_EN;

  return (
    <section className="section himno-page">
      <h1 className="page-title">{t({ es: 'Himno del Riachuelo', en: 'Anthem of the Riachuelo' })}</h1>

      <div className="himno-player">
        <button type="button" className="play-btn" onClick={togglePlay} aria-label={playing ? 'Pausar' : 'Reproducir'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="river-progress" onClick={seek} role="slider" aria-label="progreso">
          <RiverMeander className="river-progress-track" />
          <div className="river-progress-fill" style={{ width: `${progress * 100}%` }}>
            <RiverMeander />
          </div>
        </div>
        <audio ref={audioRef} src="/audio/himno-riachuelo.mp3" preload="metadata" />
      </div>

      <p className="manifiesto-line himno-pull">
        {t({ es: 'No somos la marca, somos la fe.', en: "We're not the brand, we're the faith." })}
      </p>

      <div className="anthem-lyrics">
        {verses.map((verse) => (
          <div className="anthem-verse" key={verse.title}>
            <h3>{verse.title}</h3>
            {verse.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ))}
      </div>

      <div className="chant-box">
        <h2 className="section-subtitle">{t({ es: 'Aprendé el cántico', en: 'Learn the chant' })}</h2>
        <p className="chant-line">{CHANT[lang][0]}</p>
        <p className="chant-line chant-response">{CHANT[lang][1]}</p>
      </div>

      <p className="credit-line">
        {t({
          es: 'Murga porteña / cumbia — cantado en cada tribuna desde la fundación.',
          en: 'Porteño murga / cumbia register — sung on every terrace since the club’s founding.',
        })}
      </p>
    </section>
  );
}
